# Scheduling Foundations — How JavaScript Actually Runs in a Browser

> Sibling of `scheduling-alternatives.md` (surface) and `scheduling-deep-dive.md` (plan).
> This doc builds the mental model from first principles: renderer architecture, the event loop,
> tasks vs microtasks, the input pipeline, what `isInputPending` actually queries,
> long tasks + Interaction to Next Paint (INP), and `scheduler.yield()` mechanics — culminating in why the
> common "yield only on input pending" pattern is broken and what the correct pattern looks like.
>
> Every claim has been validated against authoritative sources (HTML/Web Incubator Community Group (WICG)/World Wide Web Consortium (W3C) specs,
> Chromium design docs, Mozilla Developer Network (MDN), web.dev). Diagrams throughout. Read top-to-bottom.

---

## Foundation 1 — Renderer Process & Threads

### 1.1 A tab is not (always) one process

Pre-2018: one tab → one renderer process. Post-Chrome 67 with **Site Isolation**: each *site* (scheme + registrable domain — `https://example.com` is one site, `*.example.com` collapses into it) gets its own renderer process. A page with cross-site iframes spans multiple renderer processes, glued together by **Out-of-Process Iframes (OOPIFs)**.

```
                                          BROWSER PROCESS
                                       (one per Chrome instance)
                                                  │
                                  Inter-Process Communication (IPC) via Mojo
                                                  │
            ┌─────────────────────────┬───────────┴──────────────┬─────────────────────────────┐
            ▼                         ▼                          ▼                             ▼
        Renderer                  Renderer                   Renderer            Graphics Processing Unit (GPU) / Viz
      (example.com)         (ads.com Out-of-Process    (youtube.com Out-of-              (one shared)
                              Iframe (OOPIF))          Process Iframe (OOPIF))
```

For our extension, this means: a content script running in the main frame and a content script running in a cross-origin iframe live in **different renderer processes** with **different main threads**. They communicate only via `postMessage`. This isn't directly relevant to scheduling, but it explains why our `isInputPending` use is gated to the main frame — the function returns false for input targeting cross-origin iframes by design (Foundation 5).

> **⏱ Timings — 1.1:**
> - **Cross-process Mojo Inter-Process Communication (IPC), browser → renderer (one-way)** — **10–20 µs** best case (IO-thread bound); **few µs to several ms** typical; under load, can stretch into seconds. Exceeding: input lag, delayed requestAnimationFrame (rAF), missed frame deadline → jank. _Source: [Chromium Mojo Inter-Process Communication (IPC) latency thread](https://groups.google.com/a/chromium.org/g/chromium-mojo/c/UqpPXz_wp28) (no ref / estimate only — partial)._
> - **Out-of-Process Iframe (OOPIF) renderer process spawn** — spawn cost **~50–200 ms** (no ref / estimate only); steady-state memory **~30–50 MB private** per renderer; one process per cross-site frame at peak isolation. Exceeding: tab/iframe load latency; on low-RAM devices Chrome falls back to per-site instead of per-origin isolation. _Source: [Chrome Security Quarterly Updates 2025](https://www.chromium.org/Home/chromium-security/quarterly-updates/) (2025)._
> - **Cross-frame `postMessage` round-trip (same browser)** — **~few hundred µs** when both renderers idle (no ref / estimate only).
> - **Total: cross-process input or postMessage hop** — **~10 µs to a few ms** under healthy load.

### 1.2 Inside one renderer

A renderer process runs many threads. The main thread is one of them — but most discussion treats it as "the thread" because it owns Document Object Model (DOM), JavaScript (JS), and most of the rendering pipeline.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   RENDERER PROCESS                                         │
│                                                                                            │
│   Main thread                              Compositor thread                               │
│   ─────────────                            ──────────────────                              │
│   • parse HyperText Markup Language        • input event triage                            │
│     (HTML) / Cascading Style Sheets        • compositor scrolling                          │
│     (CSS)                                  • Cascading Style Sheets (CSS)                  │
│   • run JavaScript (JS)                      animations of transform/opacity               │
│   • Document Object Model (DOM),           • layer hit-testing                             │
│     style, layout                                                                          │
│   • paint records (record drawing          Raster threads (multiple)                       │
│     commands, not pixels)                  ────────────────────────                        │
│   • event dispatch to JavaScript (JS)      • turn paint records into                       │
│                                              bitmap tiles                                  │
│   Input/Output (IO) thread                                                                 │
│   ─────────────────────────                Worker threads                                  │
│   • receive Mojo Inter-Process             ──────────────                                  │
│     Communication (IPC) messages,          • one per Web Worker /                          │
│     route to main / compositor               Service Worker — own                          │
│                                              event loop, own JavaScript                    │
│   Media / audio threads                      (JS) heap                                     │
│   ──────────────────────                                                                   │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

A typical renderer in 2026 has ~12 threads. **Only the main thread runs page JavaScript (JS), Document Object Model (DOM), layout, and event dispatch.** Workers are off-main-thread but completely separate JavaScript (JS) contexts.

> **⏱ Timings — 1.2:**
> - **Main thread layout pass** — **<1 ms** incremental; **5–10 ms** moderately complex page (news article, GitHub diff); **tens to hundreds of ms** worst case. Exceeding: blocks paint+commit → frame missed; at 120 Hz the entire 8.33 ms budget is gone. _Source: [Browser Rendering Guide 2026](https://abdallahzakzouk.com/blog/browser-rendering-performance-guide); [RenderingNG](https://developer.chrome.com/docs/chromium/renderingng-architecture)._
> - **Main thread paint record generation** — **<1 ms** incremental; **few ms** moderate page; **tens of ms** worst case. Exceeding: delays commit to compositor → frame slips. _(no ref / estimate only)_
> - **Compositor thread per-frame work** — **~1–4 ms** typical (scroll, transform/opacity animation, layerization). Exceeding: scroll/animation jank even when main thread is idle. _(no ref / estimate only)_
> - **Raster thread per-tile generation** — **~1–10 ms per tile** Graphics Processing Unit (GPU) raster; bad cases **300 ms+** for full new tile set. Exceeding: blank/checkerboard tiles on fast scroll. _Source: [Introducing Skia Graphite, Chromium Blog Jul 2025](https://blog.chromium.org/2025/07/introducing-skia-graphite-chromes.html)._
> - **Graphics Processing Unit (GPU)/Viz frame display (aggregate + draw + swap)** — **~1–3 ms** typical, plus one v-sync wait. Exceeding: missed v-sync, display held for another refresh. _(no ref / estimate only)_
> - **V8 Garbage Collection (GC) — minor (Scavenger)** — **sub-ms to ~5 ms** typical, parallel scavenge sub-ms common. Exceeding: dropped animation frames. _Source: [The last couple years in V8's Garbage Collection (GC), wingolog Nov 2025](https://wingolog.org/archives/2025/11/13/the-last-couple-years-in-v8s-garbage-collector)._
> - **V8 Garbage Collection (GC) — major (Mark-Compact, concurrent + incremental)** — main-thread finalization **~5–30 ms** typical; **50–200 ms** on large heaps with many live objects. Exceeding: dropped frames + Interaction to Next Paint (INP) regression spikes. _Source: [Why Your React App Feels Slow — V8 Garbage Collection (GC) & Interaction to Next Paint (INP), 2026](https://dailydevpost.com/blog/v8-garbage-collector-react-performance)._
> - **Total: one full frame budget** — **16.67 ms @ 60 Hz**, **8.33 ms @ 120 Hz**, **~4.17 ms @ 240 Hz**.

### 1.3 RenderingNG: 12-stage pipeline

For background only — Chromium's "RenderingNG" architecture splits the path from "Document Object Model (DOM) mutation" to "pixels on screen" into 12 stages. Stages 1-7 run on the main thread (animate → style → layout → pre-paint → scroll → paint → commit). Stages 8-11 run on compositor + raster threads. Stage 12 is the Graphics Processing Unit (GPU) "Viz" process drawing the actual pixels.

You don't need to memorise this. The point is: when we say "the main thread is busy," it could be busy doing JavaScript (JS), or doing layout, or doing paint-record generation — all of which prevent the next task from being picked.

> **⏱ Timings — 1.3:**
> - **Frame budget @ 60 Hz** — **16.67 ms** total across all 12 stages. Exceeding: dropped frame → visible stutter. _Source: [Browser Rendering Guide 2026](https://abdallahzakzouk.com/blog/browser-rendering-performance-guide)._
> - **Frame budget @ 120 Hz** — **8.33 ms** total. Exceeding: same as above with twice the visibility. _Source: same._
> - **Long Task threshold** — **50 ms**. Exceeding: surfaced via Long Tasks Application Programming Interface (API); main thread blocked → input delay risk. _Source: [Long Tasks Application Programming Interface (API) World Wide Web Consortium (W3C) Editor's Draft 2026-03-19](https://w3c.github.io/longtasks/)._
> - **Long Animation Frame (LoAF) threshold** — **50 ms**. Exceeding: frame flagged via Long Animation Frames (LoAF) Application Programming Interface (API) with per-script attribution (`sourceURL`, `blockingDuration`, etc.). _Source: [Long Animation Frames Application Programming Interface (API), developer.chrome.com 2024-10-14](https://developer.chrome.com/docs/web-platform/long-animation-frames)._
> - **Total: any frame should fit in the budget**; if any single stage > frame budget, that frame drops.

> **Sources**: [HyperText Markup Language (HTML) §8.1.7](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops); [Site Isolation design doc](https://www.chromium.org/Home/chromium-security/site-isolation/); [RenderingNG architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture); [Inside look at modern web browser, part 3 — Mariko Kosaka](https://developer.chrome.com/blog/inside-browser-part3).

---

## Foundation 2 — The HyperText Markup Language (HTML) Event Loop

### 2.1 The processing model

Per HyperText Markup Language (HTML) §8.1.7.3 "Event loop processing model," the main thread runs forever in this loop:

```
┌─────────────────────────────────────────────────────────────────┐
│            HYPERTEXT MARKUP LANGUAGE (HTML) EVENT LOOP          │
│                                                                 │
│  while (true) {                                                 │
│    1.  Pick the OLDEST runnable TASK from any task queue        │
│    2.  Run that task to completion (synchronous)                │
│    3.  Microtask checkpoint:                                    │
│           drain microtask queue until empty                     │
│           (microtasks may queue more microtasks — keep going)   │
│    4.  If this is a "rendering opportunity":                    │
│           a. update the rendering:                              │
│              - resize / scroll / IntersectionObserver callbacks │
│              - run requestAnimationFrame callbacks              │
│              - style + layout + paint                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

Three **iron rules** that the rest of this doc depends on:

1. **One task per iteration.** The loop picks one task at step 1 and runs it. Other tasks wait.
2. **Tasks run to completion.** Once step 2 begins, nothing on the main thread interrupts it. No paint. No input dispatch. No animation frame. Until the task returns.
3. **"Rendering opportunity" is browser-decided.** Not every iteration paints. Chrome aligns to the display refresh rate (60 Hz on most screens, 120 Hz on some). Backgrounded tabs don't paint at all, so step 4 is skipped entirely.

> **⏱ Timings — 2.1:**
> - **"Pick next task" dispatch overhead** — **~5–50 µs** (no ref / estimate only — Blink scheduler internals not publicly benchmarked in window). Exceeding: dominates throughput on event-heavy pages with tiny tasks.
> - **Microtask checkpoint, 0 items** — **<1 µs** (queue-empty check). _Source: [User Interface (UI) Blocking behaviour: microtasks vs macrotasks, DEV 2024](https://dev.to/tusharshahi/ui-blocking-behaviour-microtasks-vs-macrotasks-4en1)._
> - **Microtask checkpoint, 10 items** — **~10–50 µs**.
> - **Microtask checkpoint, 100 items** — **~100 µs – 1 ms**. Exceeding: rendering and next task blocked; chained microtasks → indefinite User Interface (UI) freeze.
> - **Total: one event-loop iteration on idle main thread** — **~10–100 µs** typical (dispatch + tiny task + microtask drain).

### 2.2 What's a "task"?

A task is a queued unit of work. It comes from a **task source**. HyperText Markup Language (HTML) names many task sources:

- **Timer task source** — `setTimeout`, `setInterval` callbacks
- **Document Object Model (DOM) manipulation task source** — `MessageChannel.postMessage`, async Document Object Model (DOM) events
- **User interaction task source** — events queued in response to user input (per HyperText Markup Language (HTML); the practical input-dispatch path is more nuanced — see Foundation 4)
- **Networking task source** — `fetch` resolution, XHR completion
- **History traversal task source** — `popstate`, `hashchange`
- **Idle task source** — `requestIdleCallback`
- **Per-Application Programming Interface (API) task sources** — IntersectionObserver, performance timeline, etc.

Task source matters because **throttling rules are per-source**. The 4 ms clamp on `setTimeout(0)` after 5 nests applies *only* to the timer task source. `MessageChannel.postMessage` lives on the Document Object Model (DOM) manipulation source — no clamp. This is why React's scheduler uses `MessageChannel` instead of `setTimeout(0)`.

> **⏱ Timings — 2.2:**
> - **`setTimeout(fn, 0)` minimum delay (≤4 nested)** — **~0–1 ms** (Chrome 113 measured ~0 ms for first calls). _Source: [How to Understand the Minimum Delay Mechanism in setTimeout, jsdev.space 2024](https://jsdev.space/howto/settimeout-min-delay/)._
> - **`setTimeout(fn, 0)` after ≥5 nested timers (clamp engaged)** — **4 ms** minimum. Exceeding: ~250 Hz ceiling on chained `setTimeout(0)` loops; React abandoned this for MessageChannel for exactly this reason. _Source: [HyperText Markup Language (HTML) Standard §timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html) (normative); [jsdev.space 2024](https://jsdev.space/howto/settimeout-min-delay/)._
> - **`MessageChannel.postMessage(null)` round-trip** — **~50–200 µs** typical. Unaffected by 4 ms clamp. _Source: [Understanding MessageChannel Scheduling in React, Oreate AI 2024](https://www.oreateai.com/blog/understanding-messagechannel-scheduling-in-react-a-deep-dive/ffc72cb4baee435b40588fa2b7397312); [React PR #14249](https://github.com/facebook/react/pull/14249)._
> - **`requestAnimationFrame` callback dispatch overhead** — **~10–100 µs**. Frame cadence: 16.67 ms @ 60 Hz, 8.33 ms @ 120 Hz. Callback budget: **<10 ms** to leave room for layout+paint within frame. _Source: [Jank busting for better rendering, web.dev](https://web.dev/speed-rendering/); [requestAnimationFrame Application Programming Interface (API) — sub-millisecond precision, Chrome dev blog 2024](https://developer.chrome.com/blog/requestanimationframe-api-now-with-sub-millisecond-precision)._
> - **`requestIdleCallback` deadline budget on idle 60 Hz page** — **up to 50 ms** (spec cap). _Source: [World Wide Web Consortium (W3C) requestIdleCallback spec](https://w3c.github.io/requestidlecallback/)._
> - **`requestIdleCallback` deadline on busy page** — **1–10 ms** typical, **near 0 ms** when frame just finished heavy work. Exceeding: stealing from frame budget → next-frame jank. _Source: [Using requestIdleCallback, Chrome dev blog](https://developer.chrome.com/blog/using-requestidlecallback)._
> - **Total: typical "yield to event loop" cost** — **50–200 µs** (MessageChannel) vs **4 ms** worst-case (clamped setTimeout) — 20× difference.

### 2.3 Microtasks ≠ tasks

Microtasks are a separate queue, drained at step 3 of every iteration. Sources:

- `Promise.then / .catch / .finally` reactions
- `await` continuations (per ECMAScript, the resumption is enqueued as a Promise reaction → microtask)
- `queueMicrotask(fn)`
- **MutationObserver** callbacks (the "compound microtask")
- `FinalizationRegistry` cleanup callbacks

Critical differences vs tasks:

| Property | Task | Microtask |
|---|---|---|
| Queue position in loop | step 1 (one per iteration) | step 3 (drain to empty) |
| Can yield to rendering | Yes (after task ends) | **No** — microtasks block paint |
| Can yield to input | Yes (next task could be input) | **No** — input task waits |
| Starvable | No (one per iteration is fair) | **Yes** — chained microtasks freeze the page |

> ⚠ **`await Promise.resolve()` is NOT yielding to the browser.** It schedules a microtask. The microtask queue drains within the current loop iteration. No paint, no input dispatch happens between them. Use `setTimeout(0)`, `MessageChannel.postMessage(null)`, or `scheduler.yield()` for actual yield-to-loop semantics.

> **⏱ Timings — 2.3:**
> - **`queueMicrotask(fn)` queueing cost** — **~50–200 ns**. No allocation beyond the queue node. _Source: [queue-microtask shim README, feross 2024+](https://github.com/feross/queue-microtask)._
> - **`Promise.resolve().then(fn)` cost** — **~200–800 ns**. ~3–5× slower than `queueMicrotask` because it allocates a Promise + reaction job + queue node. _Source: [In-Depth Guide to JavaScript's queueMicrotask, Bomberbot](https://www.bomberbot.com/javascript/an-in-depth-guide-to-javascripts-queuemicrotask-techniques-patterns-and-performance/)._
> - **`await` continuation overhead (already-resolved Promise)** — **~100–500 ns** for suspend+resume bookkeeping. (1 microtick post-V8-2018, was 3 before.) _Source: [Faster async functions and promises, V8 blog](https://v8.dev/blog/fast-async) (canonical reference)._
> - **MutationObserver callback dispatch latency** — **~10 µs – 1 ms** depending on records-list size; coalescing means 1000 mutations → 1 callback. _Source: [Behind the Curtain: MutationObserver Performance, fsjs.dev 2024](https://fsjs.dev/behind-the-curtain-mutationobserver-performance-optimization/)._
> - **Total: chained microtask starvation risk** — unbounded; chained `Promise.then(...).then(...)` infinite loop = full User Interface (UI) freeze.

### 2.4 When microtasks actually run

Folk wisdom: "microtasks run at end of task." More accurate: **microtasks run whenever the JavaScript (JS) execution stack empties.** Inside a single task, if a function returns and there's no caller above (the stack is empty), the spec calls "perform a microtask checkpoint" right there. That's why a `Promise.then` callback can fire mid-task in surprising places.

For our work (chunking + yielding), this nuance rarely matters — but it explains why `await scheduler.yield()` reliably ends the current task: `await` empties the stack, the microtask checkpoint runs (queues the continuation as a Promise resolution), and the current task ends.

> **⏱ Timings — 2.4:**
> - **Stack-empty microtask checkpoint** — **<1 µs** (idle queue) to **~ms** (long queue). Same scaling as 2.1's checkpoint timings — fires whenever JavaScript (JS) stack drains, not only at task end.

### 2.5 "Macrotask" is folk usage

The term "macrotask" appears in Mozilla Developer Network (MDN) copy and Jake Archibald's "In The Loop" talk. **It is not a spec term.** The HyperText Markup Language (HTML) spec uses "task." This doc uses "task."

> **Sources**: [HyperText Markup Language (HTML) Living Standard §8.1.7](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops); [HyperText Markup Language (HTML) §8.6 Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html); [Tasks, microtasks, queues and schedules — Jake Archibald](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/); [In depth: Microtasks — Mozilla Developer Network (MDN)](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/HTML_DOM_API/Microtask_guide/In_depth).

---

## Foundation 3 — How Input Reaches Your JavaScript (JS) Handler

### 3.1 The route

A click does not jump straight from your finger to `onclick`. It travels:

```
   Hardware (mouse/touch/keyboard)
     │
     ▼
   Operating System (OS) event → delivered to Chrome's BROWSER PROCESS (User Interface (UI) thread)
     │
     │  hit-test: which renderer owns the pixel under the click?
     │  (cross-process for Out-of-Process Iframes (OOPIFs))
     ▼
   Inter-Process Communication (IPC) via Mojo message → enters the RENDERER PROCESS
     │
     ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────────┐
   │                              COMPOSITOR THREAD                                          │
   │  ─ InputHandlerProxy receives the Inter-Process Communication (IPC)                     │
   │  ─ Compositor Thread Event Queue (CTEQ)                                                 │
   │  ─ Decision: handle here, or post to main thread?                                       │
   │       • scroll/wheel + passive listener → handle on compositor (smooth scrolling        │
   │         without waiting on JavaScript (JS))                                             │
   │       • discrete events (click/keydown/keyup, touchstart/touchend) → ALWAYS post        │
   │         to main                                                                         │
   │       • events targeting non-fast-scrollable region (non-passive listener attached)     │
   │         → post to main, wait for JavaScript (JS) preventDefault decision                │
   └─────────────────────────────────────────────────────────────────────────────────────────┘
     │
     │ POST: queue task on main thread's MainThreadEventQueue
     ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────────┐
   │                                 MAIN THREAD                                             │
   │  ─ MainThreadEventQueue                                                                 │
   │  ─ Event loop picks the input task at step 1                                            │
   │  ─ Blink runs EventDispatcher                                                           │
   │  ─ Your JavaScript (JS) handler fires                                                   │
   │  ─ Microtask checkpoint                                                                 │
   │  ─ (maybe) rendering opportunity → paint reflects the response                          │
   └─────────────────────────────────────────────────────────────────────────────────────────┘
```

> **⏱ Timings — 3.1:**
> - **Operating System (OS) click delivery (Hardware (HW) → browser process)** — **~1–8 ms** (Universal Serial Bus (USB) poll 1–8 ms at 125–1000 Hz; Operating System (OS) dispatch < 1 ms). Exceeding: adds to Interaction to Next Paint (INP) input delay; uncontrollable from web platform. _(no ref / estimate only — browser-side measurement tools cannot reach below the Operating System (OS) boundary)._
> - **Browser → renderer compositor Inter-Process Communication (IPC) (Mojo)** — **~0.1–2 ms** typical, up to **~5 ms** under load. Exceeding: bloats Interaction to Next Paint (INP) input delay; worsens with extension count. _(no ref / estimate only)._
> - **Compositor input triage (`InputHandlerProxy`)** — **~50–500 µs** (sub-ms on healthy hardware). Exceeding: posts to main delayed → Interaction to Next Paint (INP) regression. _Source: [Chromium cc/input docs](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/) (living)._
> - **Main thread input task dispatch (queue pickup → EventDispatcher start)** — **~1–50 ms** depending on contention; **≥50 ms** triggers Long Animation Frames (LoAF) "blocking". Exceeding: ~18% of total Interaction to Next Paint (INP) on average per Chrome team. _Source: [Interaction to Next Paint (INP) breakdown, developer.chrome.com 2024](https://developer.chrome.com/docs/performance/insights/inp-breakdown)._
> - **JavaScript (JS) event handler ("processing duration")** — fast: **<50 ms**; slow: **>200 ms** (already pushes a single interaction to "needs improvement"). Exceeding: counted directly in Interaction to Next Paint (INP); >50 ms qualifies the frame as a Long Animation Frame. _Source: [Interaction to Next Paint (INP), web.dev](https://web.dev/articles/inp); [Long Animation Frames (LoAF) Application Programming Interface (API), developer.chrome.com](https://developer.chrome.com/docs/web-platform/long-animation-frames)._
> - **Total: click → first JavaScript (JS) handler fire on healthy page** — **~5–30 ms** typical. _Source: [Interaction to Next Paint (INP) breakdown, developer.chrome.com 2024](https://developer.chrome.com/docs/performance/insights/inp-breakdown)._

### 3.2 Compositor thread vs main thread for input

This is the key surprise: **input first hits the compositor thread, not the main thread.** Two consequences:

- **Smooth scrolling while main is blocked.** A scroll wheel turn travels Operating System (OS) → browser → compositor. If no main-thread listener will preventDefault (i.e. all wheel listeners are `passive: true`), the compositor scrolls the page itself, paints a new frame, and the user sees buttery-smooth scrolling — even if the main thread is in a 5-second long task running JavaScript (JS). This is why `addEventListener('wheel', fn, { passive: true })` matters for jank.
- **Click always goes to main.** Discrete events — `click`, `keydown`, `keyup`, `mousedown`, `mouseup`, `touchstart`, `touchend` — never have a compositor fast path. They are always posted to the main thread. So clicks block on main-thread availability.

> **⏱ Timings — 3.2:**
> - **Compositor-only smooth scroll (passive listeners)** — **~1–4 ms** compositor work per frame. Sits well under 16.67 ms / 8.33 ms frame budget. _Source: [Improving scroll performance with passive event listeners, developer.chrome.com](https://developer.chrome.com/blog/passive-event-listeners); [Browser Rendering Guide 2026](https://abdallahzakzouk.com/blog/browser-rendering-performance-guide)._
> - **Main-thread blocking scroll (non-passive wheel/touch listener)** — **16–100+ ms** per frame; any handler **>8 ms** at 120 Hz drops a frame. Exceeding: compositor stalls awaiting `preventDefault()` → visible scroll jank, Interaction to Next Paint (INP) spikes. A 50 ms handler = 3 dropped frames at 60 Hz. _Source: [passive event listeners blog, developer.chrome.com](https://developer.chrome.com/blog/passive-event-listeners)._
> - **Touch → click delay (modern, viewport meta set)** — **~0 ms** additional delay (legacy 300 ms gone since Chrome 32 / iOS 9.3). Pages without `<meta viewport>` still incur the legacy 300 ms. _Source: [300ms tap delay, gone away, developer.chrome.com](https://developer.chrome.com/blog/300ms-tap-delay-gone-away)._
> - **Total: discrete event always pays main-thread queue + dispatch cost** — same 5–30 ms healthy-page total as 3.1.

### 3.3 What does it mean for input to "be queued"?

When Inter-Process Communication (IPC) delivers an input event to the renderer's compositor thread, the event lands in a queue. If the compositor decides to hand off to main, the event is posted as a task to the main thread's queue. The task is *queued* — not yet run. It runs only when the event loop picks it (step 1 of the loop).

```
Time ────────────────────────────────────────────────────────────────▶

Main thread:  ┌──────────────────────────────────────────────┐ pick next task
              │  current task (long JavaScript (JS) loop)    │
              └──────────────────────────────────────────────┘
                                ▲                              ▲
                                │                              │
              Inter-Process Communication (IPC)         click task picked @ T=8ms
              arrives @ T=4ms                           handler fires
              click queued in main thread queue         (input delay = 4ms)
```

The gap between "click queued" and "click handler runs" is **input delay** — the first component of Interaction to Next Paint (INP).

> **⏱ Timings — 3.3:**
> - **Input queue residence time** — bounded below by current-task duration + duration of any tasks queued ahead. On idle main thread: **<1 ms**. Mid–long-task: up to the long-task duration (50–500+ ms). Exceeding: directly = Interaction to Next Paint (INP) input-delay component. _Source: [Interaction to Next Paint (INP), web.dev](https://web.dev/articles/inp)._
> - **Typical input-delay component of Interaction to Next Paint (INP) at p75 (healthy sites)** — **~37 ms**. _Source: [Web Almanac 2024 — Performance, 2024-11-11](https://almanac.httparchive.org/en/2024/performance)._

### 3.4 requestAnimationFrame (rAF)-aligned input coalescing

For continuous events (`mousemove`, `wheel`, `pointermove`, `touchmove`, `pointerrawupdate`, `drag`), Chrome 60+ coalesces them and dispatches once per frame, just before `requestAnimationFrame` callbacks run. `event.getCoalescedEvents()` exposes the merged points (drawing apps, sensitive trackpad input). Discrete events bypass coalescing — they fire immediately on the next main-thread task pick.

> **⏱ Timings — 3.4:**
> - **requestAnimationFrame (rAF)-aligned input coalescing window** — **~16.67 ms @ 60 Hz**, **~8.33 ms @ 120 Hz**. All continuous events arriving within this window merge into one dispatch. Exceeding: hit-tests reduced ~35%; raw events still recoverable via `getCoalescedEvents()`. _Source: [Aligned input events, developer.chrome.com](https://developer.chrome.com/blog/aligning-input-events)._

> **Sources**: [Inside Browser part 4 — Mariko Kosaka](https://developer.chrome.com/blog/inside-browser-part4); [Aligned input events](https://developer.chrome.com/blog/aligning-input-events); [Compositor Thread Architecture](https://www.chromium.org/developers/design-documents/compositor-thread-architecture/); [Chromium cc/input README](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/input/); [Nolan Lawson — High-perf input handling](https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/).

---

## Foundation 4 — `navigator.scheduling.isInputPending()`

### 4.1 What it actually queries

This is the surprise: it does **NOT** read the main-thread input queue. It reads the **compositor-thread** queue, where input lands first (per Foundation 3.1).

```
   Compositor thread:   [click @ T=4]  [scroll @ T=5]
                         │
                         ▼ (peek, no flush)
   Main thread:    isInputPending() ──► returns true
                   (lock-free read of compositor queue)
```

The Meta engineering blog (Comminos & Schloss, the Application Programming Interface (API)'s original proposers) confirms this. The implementation hooks into the compositor's pending-dispatch queue *before* the event hops to main. That's why the call is cheap — no Inter-Process Communication (IPC) round-trip, just a local read of a thread-local structure.

> **⏱ Timings — 4.1:**
> - **`isInputPending()` single-call cost** — **~1–10 µs** (no ref / estimate only — no public 2024–2026 microbenchmark). Mechanism: cross-thread atomic read of compositor input-queue flag.
> - **Compositor-queue-to-`true` freshness window** — **<1 ms** typical (same-process posting from compositor to main). Exceeding: stale read → main runs one extra work chunk before yielding. _(no ref / estimate only)._

### 4.2 Discrete by default, continuous opt-in

Per the Web Incubator Community Group (WICG) spec: by default `isInputPending()` returns `true` only for **discrete** events. The Interface Definition Language (IDL):

```webidl
dictionary IsInputPendingOptions {
  boolean includeContinuous = false;
};
```

A trusted event is **continuous** if its type is one of: `mousemove`, `wheel`, `touchmove`, `drag`, `pointermove`, `pointerrawupdate`. Everything else (click, keydown, touchstart, …) is discrete.

For our PII scan, discrete-only is correct: we want to yield to a click or keystroke, not to passive mouse drift across the page.

> **⏱ Timings — 4.2:**
> - **`{includeContinuous: true}` extra cost vs default** — negligible — same queue read, wider event-type filter (no ref / estimate only).
> - Exceeding: more frequent `true` returns → over-yielding → throughput loss on continuous-event-heavy pages.

### 4.3 Cross-origin iframe false negatives

Chrome docs flag this: "Setting complex clips and masks for cross-origin iframes may report false negatives." Root cause: the implementation uses **compositor-side hit testing** to decide which frame an input is targeting. For cross-origin frames (rendered by a different renderer process), this hit test runs on the Graphics Processing Unit (GPU)/Viz process. Complex Cascading Style Sheets (CSS) `clip-path` or `mask` defeats the fast-path hit test, and the implementation conservatively returns `false` rather than risk leaking timing about another origin.

> **⏱ Timings — 4.3:** No timing applies — semantic / correctness limitation, not a perf number.

### 4.4 Performance cost

Public sources do not publish a benchmarked number. Meta's blog asserts "very quick" but gives no microsecond figure. **Don't trust unsourced claims of "50-200 ns" — measure it yourself if it matters.** Mechanically: function call + lock-free queue length read + boolean return. Plausibly < 1 µs but order of magnitude is what we have.

Practical implication: **don't call it inside a tight loop with µs-scale work units.** Per Chrome docs, batch into chunks of meaningful work and check between chunks. Response, Animation, Idle, Load (RAIL) recommends a 50 ms quantum; we use 5 ms in our migration plan (Foundation 7).

> **⏱ Timings — 4.4:**
> - **`isInputPending()` × 1000 in a tight loop** — **~1–10 ms** total amortized cost (no ref / estimate only, derived from 4.1). Exceeding: if work-per-iteration < ~10 µs, the polling cost dominates.
> - **Recommended sampling cadence** — every **~50 ms** of work, OR between batches. Aligned with Response, Animation, Idle, Load (RAIL)'s `<50 ms` quantum and the long-task threshold. Exceeding 50 ms between checks: you've already missed the long-task threshold. _Source: [web.dev — Optimize long tasks (updated 2024-12-19)](https://web.dev/articles/optimize-long-tasks); [isInputPending — Chrome dev docs](https://developer.chrome.com/docs/capabilities/web-apis/isinputpending)._
> - **Real-world wins (Meta origin trial, pre-2024 figure)** — **p95 event latency reduced ~100 ms** during origin trial; throughput preserved. No 2024–2026 update located. _Source: [Web Incubator Community Group (WICG) is-input-pending spec](https://wicg.github.io/is-input-pending/) (citing original Meta data, out-of-window)._

### 4.5 Successor: `Scheduler.yield()`

Mozilla Developer Network (MDN) now flags `isInputPending` as superseded:

> "The `isInputPending()` method has been superseded by features available on the Scheduler interface such as `yield()`."

The successor isn't a renamed function — it's a different Application Programming Interface (API) shape (Promise-returning rather than synchronous boolean). For new code, prefer `scheduler.yield()` as the primary yield primitive and use `isInputPending` only as an *early-yield trigger* alongside a time budget.

> **⏱ Timings — 4.5:**
> - **`scheduler.yield()` per-call overhead** — **~10–100 µs** (no ref / estimate only): one Promise allocation + queue enqueue + new task setup + resume.
> - **`scheduler.yield()` × 1000 in tight loop** — **~10–100 ms** total. Exceeding: Web Incubator Community Group (WICG) + web.dev explicit warning — "if jobs are very short, the overhead could quickly add up to more time spent yielding than executing the actual work." Mitigation: chunk to ≥ 5 ms before yielding. _Source: [web.dev — Optimize long tasks 2024-12-19](https://web.dev/articles/optimize-long-tasks); [Web Incubator Community Group (WICG) yield-and-continuation explainer](https://github.com/Web Incubator Community Group (WICG)/scheduling-apis/blob/main/explainers/yield-and-continuation.md)._

### 4.6 Browser support, May 2026

Chromium-only. Chrome 87+, Edge 87+. Mozilla standards-positions issue #155 unsigned. WebKit no signal. Not in Firefox, not in Safari, no shipped intent.

> **Sources**: [Chrome dev docs — isInputPending](https://developer.chrome.com/docs/capabilities/web-apis/isinputpending); [Meta Engineering — isInputPending](https://engineering.fb.com/2019/04/22/developer-tools/isinputpending-api/); [Web Incubator Community Group (WICG) is-input-pending spec](https://wicg.github.io/is-input-pending/); [Mozilla Developer Network (MDN) — Scheduling.isInputPending](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduling/isInputPending); [Mozilla standards-positions #155](https://github.com/mozilla/standards-positions/issues/155).

---

## Foundation 5 — Long Tasks & Interaction to Next Paint (INP)

### 5.1 What's a "long task"

Per World Wide Web Consortium (W3C) Long Tasks Application Programming Interface (API): a long task is **any work on the main thread that exceeds 50 ms**. The work can be:

- An event-loop task (step 1+2 of the loop) plus its trailing microtask checkpoint.
- A "rendering update" (step 4) that takes too long.
- The pause **between** two event-loop steps if the loop itself is delayed (rare).

The 50 ms threshold derives from the **Response, Animation, Idle, Load (RAIL) response budget**: aim to respond to user input within 100 ms; if a 50 ms task is already in flight when input arrives, you have 50 ms left for the input task to dispatch and produce a paint.

> **⏱ Timings — 5.1:**
> - **Long Task threshold** — **50 ms**. Exceeding: surfaced via `PerformanceObserver({type: 'longtask'})`; main thread blocked → input delay risk. _Source: [Long Tasks Application Programming Interface (API) World Wide Web Consortium (W3C) Editor's Draft 2026-03-19](https://w3c.github.io/longtasks/)._
> - **Response, Animation, Idle, Load (RAIL) response budget** — respond within **100 ms**, leaving **50 ms** for handler. _Source: [web.dev/articles/rail](https://web.dev/articles/rail) (cited in [Long Tasks spec 2026-03-19](https://w3c.github.io/longtasks/))._

### 5.2 Interaction to Next Paint (INP) — Interaction to Next Paint

Interaction to Next Paint (INP) became a Core Web Vital on **March 12, 2024**, replacing First Input Delay (FID) (First Input Delay). It measures the latency of user interactions over the page lifetime.

What counts as an interaction:
- Click (mouse)
- Tap (touchscreen)
- Key press (physical or onscreen keyboard)

What does NOT count:
- Scroll
- Hover
- Pinch / zoom
- Pure swipe (one that doesn't resolve to a tap)

> **⏱ Timings — 5.2:**
> - **Date Interaction to Next Paint (INP) became a Core Web Vital** — **2024-03-12**. _Source: [Interaction to Next Paint (INP) becomes a Core Web Vital, web.dev 2024-03-12](https://web.dev/blog/inp-cwv-launch)._
> - **Date First Input Delay (FID) guaranteed availability removed** — **2024-09-09**. _Source: same._
> - **Chrome User Experience Report (CrUX) 2024 Interaction to Next Paint (INP) Core Web Vitals (CWV) pass-rate** — Mobile **74%** good (up from 55% in 2022); Desktop **97%**; mobile-desktop gap **23 pp**. _Source: [Web Almanac 2024 — Performance, 2024-11-11](https://almanac.httparchive.org/en/2024/performance)._

### 5.3 Interaction to Next Paint (INP) composition

```
Time ────────────────────────────────────────────────────────────▶

  USER     │
  click ───┤
           ▼
           ┌───────┬─────────────┬──────────────────────┐
           │ input │ event       │ presentation         │
           │ delay │ processing  │ delay                │
           └───────┴─────────────┴──────────────────────┘
                                                        ▲
                                                        │
                                               next paint with response
Interaction to Next Paint (INP) for this interaction = entire bracket
```

Three components:

- **Input delay** — from interaction start until the first event handler begins. Driven by main-thread availability. Long tasks make this big.
- **Processing duration** — handler code executing. Driven by your handler's complexity.
- **Presentation delay** — from handler end to the next paint that visually reflects the change. Driven by layout/paint cost.

> **⏱ Timings — 5.3 (p75 components, healthy sites):**
> - **Input delay** — **~37 ms**. Exceeding: pushes total Interaction to Next Paint (INP) past 200 ms "good" cutoff. _Source: [Web Almanac 2024 — Performance](https://almanac.httparchive.org/en/2024/performance)._
> - **Processing duration** — **~56 ms**. Exceeding: handler logic dominates Interaction to Next Paint (INP); primary fix target for `scheduler.yield()`. _Source: same._
> - **Presentation delay** — **~36 ms** (largest median contributor per Almanac). Exceeding: rendering/commit cost; fix via Document Object Model (DOM)-update minimisation, `content-visibility: auto`. _Source: same._
> - **Total: typical p75 Interaction to Next Paint (INP) on healthy site** — **~129 ms** (sum of three p75 components). At p75, "good" cutoff at 200 ms gives ~70 ms headroom. _Source: same._

### 5.4 Scoring (real Core Web Vital methodology)

| Threshold | Verdict |
|---|---|
| < 200 ms | Good |
| 200-500 ms | Needs improvement |
| > 500 ms | Poor |

Per-page Interaction to Next Paint (INP) value is hybrid:
- Pages with **< 50 interactions** → Interaction to Next Paint (INP) = single worst interaction.
- Pages with **≥ 50 interactions** → Interaction to Next Paint (INP) ignores the worst per ~50 (effectively ~p98 within the page) to reject outliers.

The reported field metric (used for Core Web Vitals (CWV) passing) is the **p75 of those per-page values across all visits to the URL**.

> **⏱ Timings — 5.4 (Core Web Vitals (CWV) thresholds at p75):**
> - **"Good"** — **≤ 200 ms**. _Source: [Interaction to Next Paint (INP), web.dev (updated 2025-09-02)](https://web.dev/articles/inp)._
> - **"Needs improvement"** — **> 200 ms and ≤ 500 ms**. _Source: same._
> - **"Poor"** — **> 500 ms**. Exceeding 500 ms: page fails Core Web Vitals (CWV) → ranking-signal impact. _Source: same._

### 5.5 Long Animation Frames (LoAF) — the modern attribution surface

Long Animation Frames Application Programming Interface (API) shipped Chrome 123 (March 2024). Where Long Tasks gives you "something on the main thread took > 50 ms" with crude attribution (which iframe), Long Animation Frames (LoAF) gives you per-script:

- `sourceURL`, `sourceFunctionName`, `sourceCharPosition`
- `invoker` — what triggered the script (event listener, `setTimeout`, requestAnimationFrame (rAF), etc.)
- `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `forcedStyleAndLayoutDuration`
- `firstUIEventTimestamp`

For Interaction to Next Paint (INP) debugging in 2026, prefer Long Animation Frames (LoAF) where available; fall back to Long Tasks for cross-browser support.

> **⏱ Timings — 5.5:**
> - **Long Animation Frames (LoAF) frame threshold** — **≥ 50 ms**. Exceeding: frame surfaced via Long Animation Frames (LoAF) Application Programming Interface (API); `blockingDuration` sums tasks > 50 ms. _Source: [Long Animation Frames (LoAF) docs, developer.chrome.com 2024-10-14](https://developer.chrome.com/docs/web-platform/long-animation-frames)._
> - **Long Animation Frames (LoAF) script-attribution threshold** — scripts running **> 5 ms** within a long animation frame get per-script attribution. _Source: same._
> - **Long Animation Frames (LoAF) Application Programming Interface (API) ship date** — **Chrome 123, 2024-03-13** stable (after origin trial Chrome 116–122). _Source: [Chrome Releases March 2024](https://chromereleases.googleblog.com/2024/03/); [Long Animation Frames (LoAF) has shipped, developer.chrome.com](https://developer.chrome.com/blog/loaf-has-shipped)._
> - **Real-world Interaction to Next Paint (INP) wins from `scheduler.yield()` adoption (2024 case studies):**
>   - **Trendyol** — p75 Interaction to Next Paint (INP) **963 ms → ~650 ms** (~50% reduction). _Source: [web.dev/case-studies/trendyol-inp](https://web.dev/case-studies/trendyol-inp)._
>   - **Taboola** — publisher A **75 → 48 ms** (36%); publisher C **135 → 92 ms** (33%); publisher D **52 → 37 ms** (29%); RELEASE.js Total Blocking Time (TBT) **691 → 206 ms** (70%). _Source: [web.dev/case-studies/taboola-inp 2024-02-01](https://web.dev/case-studies/taboola-inp)._
>   - Range across reported cases: **6–50%** p75 Interaction to Next Paint (INP) reduction.

> **Sources**: [Interaction to Next Paint (INP) — web.dev](https://web.dev/articles/inp); [Interaction to Next Paint (INP) becomes a Core Web Vital on March 12](https://web.dev/blog/inp-cwv-march-12); [Long Tasks Application Programming Interface (API) spec](https://w3c.github.io/longtasks/); [Long Animation Frames Application Programming Interface (API)](https://developer.chrome.com/docs/web-platform/long-animation-frames); [The Response, Animation, Idle, Load (RAIL) performance model](https://web.dev/articles/rail).

---

## Foundation 6 — `scheduler.yield()` Mechanics

### 6.1 What `await scheduler.yield()` does

Splits the current async function's body into two tasks. The pre-`await` half is the current task; the post-`await` continuation is queued as a *new task* on the scheduler's continuation queue.

```
Original async function:                     Effect at runtime:

async function work() {                      ┌──────────────────────┐
  doStuff_part1();        ───┐               │ TASK A:              │
  await scheduler.yield(); ──┤               │   doStuff_part1()    │
  doStuff_part2();        ───┐               │   (await ends task)  │
}                            │               └──────────────────────┘
                             │                          │
                             │                          ▼ event loop picks next task
                             │               ┌──────────────────────┐
                             └─────────────► │ TASK B: continuation │
                                             │   doStuff_part2()    │
                                             └──────────────────────┘
```

> **⏱ Timings — 6.1:**
> - **`await scheduler.yield()` continuation latency** — **~0.1–5 ms** typical (longer if higher-priority tasks ahead) (no ref / estimate only). Exceeding: jank, missed 16.67 ms frame budget, Interaction to Next Paint (INP) regression past 200 ms target. _Source: [Mozilla Developer Network (MDN) Scheduler.yield (2025-09-25)](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduler/yield)._
> - **`scheduler.yield()` overhead per call** — **~10–100 µs** (no ref / estimate only): Promise alloc + boosted-queue enqueue + new task pickup. Exceeding: dominates wall-time if work-per-iteration < ~100 µs (web.dev explicit warning). _Source: [web.dev — Optimize long tasks 2024-12-19](https://web.dev/articles/optimize-long-tasks)._

### 6.2 Continuation queue + effective priority

Per Web Incubator Community Group (WICG) spec, the scheduler maintains queues keyed by `(priority, isContinuation)`. Three priorities × {fresh, continuation} = 6 logical queues:

| Priority | Continuation? | Effective priority |
|---|---|---|
| `'background'` | false | 0 (lowest) |
| `'background'` | true | 1 |
| `'user-visible'` | false | 2 |
| `'user-visible'` | true | 3 |
| `'user-blocking'` | false | 4 |
| `'user-blocking'` | true | 5 (highest) |

Selection algorithm (§2.4.3 of Web Incubator Community Group (WICG) spec): pick the queue with highest effective priority that has runnable tasks; from that queue, pick the oldest (FIFO).

A continuation slots **between** its base priority and the next higher one. The "+1" framing is shorthand — there's no numeric arithmetic.

> **⏱ Timings — 6.2:**
> - **Effective-priority queue selection** — **O(1) per dispatch** (UA picks oldest task at highest effective priority); absolute ns: no ref / estimate only.
> - **Continuation queue drain** — **O(N) FIFO**, **~10–100 µs per dequeue** (no ref / estimate only). Exceeding: starvation of lower-priority `postTask` while continuations drain. _Source: [Web Incubator Community Group (WICG) yield-and-continuation explainer](https://github.com/Web Incubator Community Group (WICG)/scheduling-apis/blob/main/explainers/yield-and-continuation.md)._

### 6.3 Worked example

```js
scheduler.postTask(async () => {
  console.log('A1');
  await scheduler.yield();
  console.log('A2');
}, { priority: 'user-visible' });

scheduler.postTask(() => console.log('B'), { priority: 'user-visible' });
```

```
Event loop iterations:

Iter 1:  pick highest-pri runnable task
         queues: { (uv, fresh): [A, B], everything else empty }
         → run A's first half: log 'A1', then yield
         → A's continuation enqueues at (uv, continuation)
         queues now: { (uv, fresh): [B], (uv, continuation): [A2] }

Iter 2:  pick highest-pri runnable task
         (uv, continuation) effective priority = 3
         (uv, fresh)        effective priority = 2
         → continuation wins: log 'A2'
         queues now: { (uv, fresh): [B] }

Iter 3:  pick highest-pri runnable task
         → log 'B'
```

Output: **A1, A2, B** — not A1, B, A2.

Compare with `await new Promise(r => setTimeout(r, 0))` instead of `scheduler.yield()`:

```
Iter 1:  run A's first half: 'A1', schedule continuation as setTimeout(0)
         (timer task source — separate queue from scheduler)
Iter 2:  pick next task — but B was queued first → log 'B'
Iter 3:  log 'A2'
```

Output: **A1, B, A2**. Continuation lost its place.

> **⏱ Timings — 6.3:** No timing applies — illustrative ordering only.

### 6.4 What happens between yield and continuation

Between the two tasks, the event loop completes a full iteration:

- ✅ Microtask checkpoint runs (after A's first half).
- ✅ Possibly a rendering opportunity — paint can happen.
- ✅ Other queued tasks of higher effective priority run.
- ✅ Input dispatch happens if input was queued and its priority outranks the continuation.

The yield is therefore a real "let the browser breathe" point — not a fake microtask trick.

> **⏱ Timings — 6.4 (gap between yield and continuation):**
> - **Microtask checkpoint** — **<1 µs to ~ms** depending on queue length (per 2.1).
> - **Rendering opportunity** — **0 ms** (skipped) up to **~16 ms** if a paint runs (browser-decided).
> - **Higher-priority tasks running ahead of continuation** — unbounded; user-blocking input or requestAnimationFrame (rAF) callbacks slot in here.
> - **Total: typical gap** — **~ms-scale** on a healthy idle main thread; **tens of ms** when input or rendering needs the slot.

### 6.5 Priority inheritance

`scheduler.yield()` inherits from the surrounding `postTask`'s priority. Outside any `postTask`, defaults to `'user-visible'`. Surprising case: **inside `requestIdleCallback`**, the inherited priority is `'background'` AND the continuation is non-abortable (no signal to attach to).

> **⏱ Timings — 6.5:** No timing applies — semantic / behavioural fact.

### 6.6 Polyfill caveat

`@google-chrome/scheduler-polyfill` v1.3.0 (Oct 2024, latest as of May 2026):

```js
// From the polyfill source
yield() {
  // Inheritance is not supported. Use default options instead.
  return this.postTaskOrContinuation_(() => {}, { priority: 'user-visible' }, true);
}
```

Polyfilled continuations always run at `'user-visible'` regardless of base priority. On native browsers (Chrome 129+, Firefox 142+) the polyfill detects native and bails — no degradation.

> **⏱ Timings — 6.6:**
> - **Polyfill yield extra cost vs native** — **~100 µs to 4 ms per yield** (no ref / estimate only): MessageChannel path ~µs, `setTimeout` fallback hits the 4 ms clamp after nesting. Exceeding: under nested yields the polyfill collapses to **4 ms-per-yield** — 10–20× slower than native. _Source: [scheduler-polyfill v1.3.0 README, 2024-10-22](https://github.com/GoogleChromeLabs/scheduler-polyfill)._
> - **Polyfill `yield()` priority behaviour** — always **`'user-visible'`** continuation priority; no priority/signal inheritance. Confirmed v1.3.0+ (2024–2026). _Source: same._

### 6.7 Browser support (May 2026, validated)

| Browser | Version | Notes |
|---|---|---|
| Chrome | 129+ (Sep 2024) | Native, full inheritance |
| Edge | 129+ | Chromium parity |
| Firefox | **142+** (pref `dom.enable_web_task_scheduling` on by default) | Native |
| Safari | not shipped | No public intent |

> **⏱ Timings — 6.7 (ship dates):**
> - **Chrome 129 stable** — **2024-09-17**. _Source: [Chrome Releases blog 2024-09-17](https://chromereleases.googleblog.com/2024/09/stable-channel-update-for-desktop_17.html)._
> - **Firefox 142 stable** — **2025-08-19** (pref `dom.enable_web_task_scheduling` preffed on by default). _Source: [Firefox 142 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/142)._

> **Sources**: [Web Incubator Community Group (WICG) Scheduling APIs spec](https://wicg.github.io/scheduling-apis/); [yield-and-continuation explainer](https://github.com/Web Incubator Community Group (WICG)/scheduling-apis/blob/main/explainers/yield-and-continuation.md); [Mozilla Developer Network (MDN) — Scheduler.yield](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduler/yield); [Chrome dev blog: Use scheduler.yield](https://developer.chrome.com/blog/use-scheduler-yield); [scheduler-polyfill v1.3.0 source](https://github.com/GoogleChromeLabs/scheduler-polyfill); [caniuse Scheduler.yield](https://caniuse.com/mdn-api_scheduler_yield).

---

## Foundation 7 — Putting It Together: The Anti-Pattern

Now we can finally explain why the anti-pattern in `scheduling-deep-dive.md` III.2.d is broken.

### 7.1 The anti-pattern code

```js
// WRONG — yield only when isInputPending() returns true.
while (workQueue.length) {
  process(workQueue.shift());
  if (navigator.scheduling.isInputPending()) {
    await scheduler.yield();
  }
}
```

### 7.2 What goes wrong — timeline

Suppose `process(item)` of one work item takes 8 ms (a moderate chunk). The user clicks at T=4 ms (mid-chunk).

```
T=0ms                                                                    T=8ms
 │                                                                        │
 ▼                                                                        ▼

Main thread:
 ┌────────────────────────────────────────────────────────────────────────┐
 │ TASK CURRENTLY RUNNING: process(item) — 8ms                            │
 │                                                                        │
 │  Iron Rule #2: tasks run to completion. NOTHING interrupts.            │
 │  ┌──────────────────────────────────────────┐                          │
 │  │ Inside the task we DO call               │                          │
 │  │ isInputPending() — but only at the       │                          │
 │  │ TOP of the next loop iteration.          │                          │
 │  │ Inside the work itself we don't peek.    │                          │
 │  └──────────────────────────────────────────┘                          │
 └────────────────────────────────────────────────────────────────────────┘

Compositor thread (in parallel):
                 │
                 ▼ T=4: click Inter-Process Communication (IPC) arrives
   Click queued in Compositor Thread Event Queue (CTEQ)
                       │
                       ▼ T=4.x: posted to main thread input queue
   But main thread is in the long task. Click waits.

Iteration check fires at T=8 (next loop iteration of OUR while loop):
                                 │
                                 ▼
                      isInputPending() returns TRUE
                      → await scheduler.yield()
                                 │
                                 ▼ T=8: yield ends task
                      Main thread free.
                      Event loop picks NEXT task.
                      Next task = click input task.
                                 │
                                 ▼ T=8: click handler fires

INPUT DELAY = 8 - 4 = 4ms (just from this one chunk)
```

Three things going wrong:

1. **Peek runs only between iterations of OUR loop, not during them.** Once `process(item)` starts, the iron rule from Foundation 2 takes over. We don't get to peek until `process` returns.
2. **The peek happens too late.** By the time `isInputPending()` fires at T=8 ms, 4 ms of input delay are already baked in.
3. **No upper bound on chunk duration.** If `process(item)` takes 50 ms, input delay is 50 ms. The pattern degrades silently with item complexity.

The deeper problem: **on a fully idle page (user reading, no clicks), the loop never yields.** `isInputPending` returns false forever. The whole thing becomes one giant long task. This is the chained-timer trap from a different angle — the pattern *appears* responsive in benchmarks where input is constant, then catastrophically fails in the common case where it's sparse.

> **⏱ Timings — 7.2 (anti-pattern, illustrative scenario):**
> - **Per-chunk duration** — **8 ms** (illustrative; can be much higher in practice as chunk size doesn't adapt).
> - **Input delay accumulated** — **≈ chunk length** at worst case (4 ms in the diagram, up to 50–100+ ms on real workloads).
> - **Idle-page worst case** — **unbounded** — the loop becomes one giant long task with NO yields, exceeding 50 ms long-task threshold trivially and hammering Interaction to Next Paint (INP).

### 7.3 The correct pattern — code

```js
let chunkStart = performance.now();
while (workQueue.length) {
  process(workQueue.shift());

  const elapsed = performance.now() - chunkStart;
  const inputPending = navigator.scheduling?.isInputPending?.() ?? false;

  if (inputPending || elapsed > 5) {
    await scheduler.yield();
    chunkStart = performance.now();
  }
}
```

Two yield triggers OR'd:

- **Time budget (5 ms)** — yields unconditionally every 5 ms. Bounds chunk length even on idle pages.
- **Input-pending peek** — yields *immediately* if input is queued, even before 5 ms.

### 7.4 Correct pattern — timeline

Same scenario: click at T=4 ms. But `process(item)` is now small enough (~1 ms each) to fit in the budget — that's part of the contract.

```
T=0ms                T=4ms              T=5ms
 │                    │                  │
 ▼                    ▼                  ▼

Main thread: ITER 1  ITER 2  ITER 3  ITER 4  ITER 5  CHECK
              [p]     [p]     [p]     [p]     [p]     │
                                                      │
              ▲       ▲       ▲       ▲       ▲       │
              │       │       │       │       │       │
              process 1 item per iteration            │
              (~1ms each)                             │
                                                      ▼
                                              elapsed = 5ms
                                              OR isInputPending = true
                                              → yield

Compositor thread (in parallel):
                       │
                       ▼ T=4: click Inter-Process Communication (IPC) arrives
        Click queued in Compositor Thread Event Queue (CTEQ) → posted to main queue

Main thread continues ITER 5 (was already in flight at T=4) → finishes T=5
                                              │
Iter 5 check fires at T=5:                    │
  isInputPending() → TRUE (click queued at T=4)
  OR elapsed > 5ms                            │
  → yield                                     ▼
                                       Main thread free
                                       Event loop picks next task = click
                                              │
                                              ▼ T=5: click handler fires

INPUT DELAY = 5 - 4 = 1ms
```

Click latency dropped from 4 ms to 1 ms. And on an idle page with no clicks, the time-budget branch fires every 5 ms — chunks stay bounded — Interaction to Next Paint (INP) stays clean.

> **⏱ Timings — 7.4 (correct pattern):**
> - **Time budget per chunk** — **5 ms** (chosen target). Chunks bounded regardless of input. Exceeding: > 50 ms = long task, Interaction to Next Paint (INP) regression. _Source: [web.dev — Optimize long tasks 2024-12-19](https://web.dev/articles/optimize-long-tasks); Response, Animation, Idle, Load (RAIL) 50 ms budget._
> - **Click latency in scenario** — **~1 ms** (peek catches input within the 5 ms chunk).
> - **Yield overhead per chunk** — **~10–100 µs** (per 6.1) — small fraction of the 5 ms work budget.
> - **Total: end-to-end click latency on busy page** — **5 ms** time-budget ceiling vs **chunk-length** in the anti-pattern. **5–20× improvement** depending on chunk size.

### 7.5 Why time budget AND input-pending (not either alone)

| Pattern | Idle page (no input) | Heavy typing |
|---|---|---|
| Time budget only | ✅ 5 ms chunks, Interaction to Next Paint (INP) clean | ⚠ Up to 5 ms input delay |
| `isInputPending` only | ❌ Never yields → giant long task | ✅ Yields on every input |
| **Both OR'd** | ✅ 5 ms chunks | ✅ Yields immediately on input |

Both. Always. The time budget is the floor on responsiveness; `isInputPending` lets you go *under* the floor when there's actual input.

> **⏱ Timings — 7.5 (per pattern variant):**
> - **Time-budget only, idle page** — chunks bounded at **5 ms**.
> - **Time-budget only, busy page** — input delay up to **5 ms** (acceptable).
> - **`isInputPending`-only, idle page** — **unbounded** long task. Interaction to Next Paint (INP) catastrophic.
> - **`isInputPending`-only, busy page** — input delay near **0 ms** (good).
> - **Both OR'd, idle page** — chunks bounded at 5 ms.
> - **Both OR'd, busy page** — input delay bounded at min(5 ms, isInputPending check rate).

### 7.6 Visual summary

```
ANTI-PATTERN: yield only on isInputPending()
─────────────────────────────────────────────────────────────
[──── chunk (8ms, can be longer) ────][peek][──── chunk ────]
                                       ▲
                          click latency ≈ chunk length
                          IDLE PAGE: never yields, 1 giant task

FIXED-CHUNK (current Personally Identifiable Information (PII) scan, no peek)
──────────────────────────────────────────────────────────────────────────────
[──── 500 nodes / ~15ms ────][──── 500 nodes / ~15ms ────]
                              ▲
                  click latency ≈ chunk length
                  No adaptation to main-thread load

CORRECT: time budget (5ms) OR isInputPending — whichever first
─────────────────────────────────────────────────────────────
[5ms][peek][5ms][peek][5ms][peek][5ms][peek]
            ▲
   click latency ≤ 5ms always
   chunks bounded on idle pages too
```

---

## Foundation 8 — Tying It Back to Our Codebase

The PII chunked scan in `src/pii/pii.js:84-112` is exactly the fixed-chunk anti-shape from §7.6 row 2. Code:

```js
function _runChunked(walker, total, enabledTypes, onDone, schedule) {
  var count = 0;
  var node;
  while (count < CHUNK_SIZE && (node = walker.nextNode())) {  // CHUNK_SIZE = 500
    total += _processTextNode(node, enabledTypes);
    count++;
  }
  // ... reschedule via requestIdleCallback or setTimeout
}
```

Issues:

1. **No deadline check.** Even when running under `requestIdleCallback` (which provides `deadline.timeRemaining()`), the code ignores it. Always processes 500 nodes.
2. **No `isInputPending` peek.** Typing in a contenteditable while the scan runs gets the "process 500 nodes first" treatment.
3. **Chunk size doesn't adapt to main-thread load.** On a busy page (heavy Garbage Collection (GC), layout from a SPA's React re-render), each `_processTextNode` is slower → 500 nodes can be 50-100 ms of work.

The migration plan in `scheduling-deep-dive.md` Phase 2 replaces this with the §7.3 correct-pattern shape — `scheduler.postTask({priority: 'user-visible'}) + scheduler.yield()` driven by a 5 ms time budget with `isInputPending` early-trigger. This is the one-paragraph version of why that's the right fix.

The MutationObserver (MO) drain in `src/core/observer.js:186-214` has the same shape (`_processObservedChanges` runs full chunks of `ENGINE_CHUNK_SIZE = 500` nodes with no deadline check) and is the second-priority migration target.

> **⏱ Timings — 8 (per-operation, modern desktop V8 / Chrome 120+; mobile mid-tier ~3–5× slower):**
>
> _DOM walking + matching:_
> - **`TreeWalker.nextNode()` SHOW_TEXT, per node** — **~50–300 ns**. Exceeding: 10 k text nodes → ~3 ms walk; > 50 ms = long-task. _(no ref / estimate only — derived from MeasureThat 2024 benches)._
> - **`TreeWalker` SHOW_ALL, per node** — **~80–500 ns** (1.5–2× SHOW_TEXT). _(no ref / estimate only)._
> - **Walk Wikipedia-class article body (~3–8 k text nodes)** — **~3–30 ms** walk-only; **~10–80 ms** with regex callback. Exceeding: single 80 ms task = visible Interaction to Next Paint (INP) hit. _Estimated from per-node × Almanac 2024 Document Object Model (DOM) data._
>
> _Regex matching:_
> - **`/.+@.+\..+/.test(text)` on ~100-char text node** — **~200 ns – 2 µs**. Exceeding: catastrophic backtracking on adversarial input → seconds. _Source: [Smashing Magazine, Aug 2024 — Regexes Got Good](https://www.smashingmagazine.com/2024/08/history-future-regular-expressions-javascript/); [V8 Irregexp blog](https://v8.dev/blog/speeding-up-regular-expressions)._
> - **7-alternation numeric PII regex on 100-char text** — **~1–10 µs**. Exceeding: per-char alt-set evaluation; over 5 k text nodes = **5–50 ms** total → visible jank. _Source: [V8 regexp tier-up](https://v8.dev/blog/regexp-tier-up) (architecture unchanged)._
> - **PII regex throughput (single-threaded V8)** — **~5–50 MB/s** of text body. Exceeding: < 10 MB/s = noticeable scan delay; < 1 MB/s = blocks interaction. _Source: [Edge Delta — PII Masking at Scale](https://edgedelta.com/company/blog/pii-masking-at-scale-a-performance-test); [arXiv 2510.07551 — Hybrid PII Detection (Oct 2025)](https://arxiv.org/html/2510.07551v1)._
>
> _DOM mutation primitives:_
> - **`document.createElement('span')`** — **~1–5 µs**. Exceeding: 10 k creates = **10–50 ms** blocking. _Source: [krausest js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/) (continuously updated)._
> - **`Node.splitText(offset)`** — **~2–10 µs**. Exceeding: per-text-node split for redaction over 5 k nodes = **10–50 ms** total. _(no ref / estimate only)._
> - **`parent.replaceChild(new, old)`** — **~3–15 µs** live tree, **~0.5–2 µs** disconnected. Exceeding: counts as 2 mutation records; live-tree replaceChild triggers style invalidation on parent subtree. _Source: [whatwg/dom #814](https://github.com/whatwg/dom/issues/814)._
> - **`element.dataset.foo = 'bar'` / `setAttribute('data-foo', 'bar')`** — **~0.5–3 µs**. Exceeding: if a Cascading Style Sheets (CSS) rule matches `[data-foo]`, triggers style recalc. _Source: [MeasureThat: setAttribute vs dataset](https://www.measurethat.net/Benchmarks/Show/11819/0/dataset-vs-setattribute)._
> - **`querySelectorAll('*')` on ~5 k-element page** — **~1–5 ms**. _Source: [Web Almanac 2024 — Markup](https://almanac.httparchive.org/en/2024/markup) (90th-percentile mobile = 1716 elements)._
>
> _Style + paint:_
> - **MutationObserver callback latency from mutation → callback** — **~50 µs – 2 ms**; microtask-queued, NOT synchronous. _Source: [Behind the Curtain: MutationObserver Performance, fsjs.dev 2024](https://fsjs.dev/behind-the-curtain-mutationobserver-performance-optimization/); [Mozilla Developer Network (MDN) Microtask guide](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/HTML_DOM_API/Microtask_guide)._
> - **Style invalidation cascade for `[data-bl-si-blur] { filter: blur(10px) }` stamping N elements** —
>   - N = 100: **~0.5–2 ms**
>   - N = 1000: **~5–25 ms**
>   - N = 10000: **~80–400 ms**
>   - Exceeding 50 ms: long-task; > 100 ms: Interaction to Next Paint (INP) regression. Recalc + paint-tree rebuild + compositor layer per filter. _Source: [web.dev — Reduce style-calc complexity](https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations); [Patrick Brosset — Style Recalc Secrets](https://noti.st/patrickbrosset/NIyBLK/style-recalculation-secrets-they-dont-want-you-to-know)._
> - **`filter: blur()` paint per element on Graphics Processing Unit (GPU) compositor** — **~0.2–3 ms** (radius 10 px, ~500×500 box); larger boxes / radius > 20 px: **5–20 ms**. Exceeding: many blurred elements fragment Graphics Processing Unit (GPU) memory and stall raster. _Source: [F22 Labs — How Cascading Style Sheets (CSS) Properties Affect Performance](https://www.f22labs.com/blogs/how-css-properties-affect-website-performance/); [Motion — Web Animation Performance Tier List](https://motion.dev/magazine/web-animation-performance-tier-list)._
>
> _Total budget for a chunk in this codebase:_
> - **PII chunked scan target (post-migration)** — **≤ 5 ms work** between yields. Today's 500-node chunk = **5–25 ms** in practice (no deadline check). After migration: ~1–5 ms per chunk, click latency bounded at 5 ms.
> - **MutationObserver (MO) drain target (post-migration)** — same 5 ms target. Today's `_processObservedChanges` runs full 500-node chunks at variable cost.
> - **Whole-document initial PII scan on Wikipedia-class page** — **~10–80 ms** today (single set of chunks). Post-migration: same total time but split across **~2–16** chunks of 5 ms each, with input/paint slots between → Interaction to Next Paint (INP)-clean.

---

## Glossary

- **Compositor thread** — A renderer-process thread that owns scrolling, simple animations, and first-stage input triage. Doesn't run page JavaScript (JS).
- **Continuation** — In scheduler-Application Programming Interface (API) parlance, a task that resumes an `await scheduler.yield()`. Flagged with `isContinuation = true` and given an effective-priority slot above fresh tasks of the same nominal priority.
- **Compositor Thread Event Queue (CTEQ)** — `CompositorThreadEventQueue`. The queue where input lands first inside the renderer.
- **Effective priority** — Combined `(priority, isContinuation)` selector key for scheduler queues. Continuations slot between adjacent priorities.
- **Event loop** — The HyperText Markup Language (HTML) spec's main-thread processing model: pick task → run → drain microtasks → maybe render. Repeat forever.
- **Idle period** — A window between rendering steps when the UA grants `requestIdleCallback` callbacks. Length capped at 50 ms by spec.
- **Interaction to Next Paint (INP)** — Interaction to Next Paint. Core Web Vital measuring user-interaction latency. Replaced First Input Delay (FID) in March 2024.
- **InputHandlerProxy** — Compositor-thread component that triages incoming input, deciding compositor-handle vs main-thread-post.
- **Iron rules** — (1) one task per loop iteration; (2) tasks run to completion; (3) rendering is browser-decided.
- **Long Animation Frames (LoAF)** — Long Animation Frames Application Programming Interface (API). Per-script attribution surface, supersedes Long Tasks for Interaction to Next Paint (INP) debugging. Chrome 123+.
- **Long task** — Main-thread work exceeding 50 ms. Per World Wide Web Consortium (W3C) Long Tasks Application Programming Interface (API).
- **Main thread** — The renderer thread that runs JavaScript (JS), Document Object Model (DOM), layout, paint records, event dispatch. The one thread you mostly think about.
- **Microtask** — Queue position drained at end of every event-loop task and whenever the JavaScript (JS) stack empties. Sources: Promise reactions, `queueMicrotask`, MutationObserver.
- **Microtask checkpoint** — The spec algorithm that drains the microtask queue.
- **Out-of-Process Iframe (OOPIF)** — Out-of-process iframe. Cross-site iframes run in a separate renderer process.
- **Response, Animation, Idle, Load (RAIL)** — Response/Animation/Idle/Load performance model. Source of the 50 ms long-task threshold (predecessor framing to Core Web Vitals).
- **Renderer process** — One per site (post Site Isolation). Owns Document Object Model (DOM), JavaScript (JS), layout, paint records for that site.
- **Run-to-completion** — The guarantee that nothing on the main thread interrupts a running task.
- **Site Isolation** — Chrome 67+ architecture: each site (scheme + registrable domain) gets its own renderer process.
- **Task source** — A logical stream of tasks per HyperText Markup Language (HTML) spec: timer, Document Object Model (DOM)-manipulation, user-interaction, idle, etc. Throttling rules are per-source.
- **Task** — A queued unit of work, picked one per event-loop iteration.

---

## References

### Specifications
- [HyperText Markup Language (HTML) Living Standard §8.1.7 — Event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)
- [HyperText Markup Language (HTML) §8.6 — Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html)
- [Web Incubator Community Group (WICG) Prioritized Task Scheduling](https://wicg.github.io/scheduling-apis/)
- [Web Incubator Community Group (WICG) yield-and-continuation explainer](https://github.com/Web Incubator Community Group (WICG)/scheduling-apis/blob/main/explainers/yield-and-continuation.md)
- [Web Incubator Community Group (WICG) is-input-pending](https://wicg.github.io/is-input-pending/)
- [World Wide Web Consortium (W3C) Long Tasks Application Programming Interface (API)](https://w3c.github.io/longtasks/)
- [World Wide Web Consortium (W3C) requestIdleCallback](https://w3c.github.io/requestidlecallback/)
- [World Wide Web Consortium (W3C) User Interface (UI) Events](https://www.w3.org/TR/uievents/)

### Chromium / Chrome
- [Inside look at modern web browser, parts 1-4 — Mariko Kosaka](https://developer.chrome.com/blog/inside-browser-part1)
- [RenderingNG architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture)
- [Site Isolation design doc](https://www.chromium.org/Home/chromium-security/site-isolation/)
- [Compositor Thread Architecture](https://www.chromium.org/developers/design-documents/compositor-thread-architecture/)
- [Aligning input events](https://developer.chrome.com/blog/aligning-input-events)
- [isInputPending — Chrome dev docs](https://developer.chrome.com/docs/capabilities/web-apis/isinputpending)
- [Use scheduler.yield()](https://developer.chrome.com/blog/use-scheduler-yield)
- [Long Animation Frames Application Programming Interface (API)](https://developer.chrome.com/docs/web-platform/long-animation-frames)
- [Heavy throttling of chained JavaScript (JS) timers in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)

### web.dev
- [Interaction to Next Paint (INP)](https://web.dev/articles/inp)
- [Interaction to Next Paint (INP) becomes a Core Web Vital](https://web.dev/blog/inp-cwv-march-12)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [The Response, Animation, Idle, Load (RAIL) performance model](https://web.dev/articles/rail)
- [Defining Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)

### Mozilla Developer Network (MDN)
- [Scheduler.postTask](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduler/postTask)
- [Scheduler.yield](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduler/yield)
- [Scheduling.isInputPending](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Scheduling/isInputPending)
- [Window.requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/Window/requestIdleCallback)
- [Microtask guide — in depth](https://developer.mozilla.org/en-US/docs/Web/Application Programming Interface (API)/HTML_DOM_API/Microtask_guide/In_depth)

### External writing
- [Tasks, microtasks, queues and schedules — Jake Archibald](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)
- [In The Loop — Jake Archibald talk](https://www.youtube.com/watch?v=cCOL7MC4Pl0)
- [High-performance input handling on the web — Nolan Lawson](https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/)
- [isInputPending — Meta Engineering](https://engineering.fb.com/2019/04/22/developer-tools/isinputpending-api/)
- [Building a Faster Web Experience with the postTask Scheduler — Airbnb](https://medium.com/airbnb-engineering/building-a-faster-web-experience-with-the-posttask-scheduler-276b83454e91)
