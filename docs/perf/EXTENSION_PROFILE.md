# Blurry Site — Extension Performance Profile

## 1. Extension Overview

**User-facing purpose:** Blurry Site is a privacy browser extension that lets users blur sensitive DOM content on any webpage. Users can blur all content at once, pick individual elements to blur, draw sticky zones, auto-detect PII (emails and financial numbers), and temporarily reveal blurred content via hover or click.

**Extension type:** Content-script-heavy MV3 extension. Nineteen JavaScript files and one CSS file are injected at `document_idle` on every URL (`<all_urls>`). The majority of CPU and heap usage originates in the content-script context, not the background.

**Background:** MV3 service worker (`background.js`). Stateless between wake cycles — it only relays keyboard-shortcut commands to tabs, manages context menus, and proxies `chrome.storage.local` reads and writes. It holds no mutable in-memory state.

**Key user flows and the modules they exercise:**

| Flow | Modules exercised |
|---|---|
| Blur-all toggle | `blur_engine`, `storage_manager`, `content_script` |
| Element picker (dynamic/sticky) | `picker`, `blur_engine`, `selector_utils`, `storage_manager` |
| PII auto-detect | `pii_detector`, `content_script` |
| Reveal (hover / click) | `reveal_controller`, `blur_engine` |
| Keyboard shortcuts | `shortcut_handler`, `action_registry`, `content_script` |
| SPA navigation detection | `url_matcher`, `content_script` |
| Auto-blur on idle / tab switch | `auto_blur`, `content_script` |
| Screenshot with blur preserved | `screenshot` |

---

## 2. Module Architecture

| Module | Exposed Global | Primary Responsibility | Perf Tier |
|---|---|---|---|
| `blur_engine.js` | `blsi.BlurEngine` | DOM blur state machine, CSS injection, MutationObservers, shadow DOM traversal, item reconciliation | HIGH |
| `pii_detector.js` | `blsi.PiiDetector` | TreeWalker + regex scan of text nodes, splitText span wrapping, mutation-driven re-scan | HIGH |
| `content_script.js` | _(orchestrator)_ | Init, message routing, `_reconcile()` loop, SPA URL-change detection | HIGH |
| `reveal_controller.js` | `blsi.Reveal` | Mouseover/mouseout capture-phase handler at up to 60 Hz, ancestor-chain walk on every event | MEDIUM |
| `auto_blur.js` | `blsi.AutoBlur` | Idle detection via throttled mousemove/keydown/scroll listeners, tab-visibility monitoring | MEDIUM |
| `picker.js` | `blsi.Picker` | Floating toolbar UI, drag zone drawing, hover highlight on mousemove | MEDIUM |
| `storage_manager.js` | `blsi.Storage` | `chrome.storage.local` async wrapper; result passed up to caller on every reconcile | MEDIUM |
| `selection_blur.js` | `blsi.SelectionBlur` | TreeWalker + `splitText` on user text selection to wrap ranges in `[data-bl-si-blur]` spans | LOW |
| `selector_utils.js` | `blsi.SelectorUtils` | Selector stamping (`data-bl-si-id`) and `querySelector` restore for persisted items | LOW |
| `blur_timer.js` | `blsi.BlurTimer` | Countdown timer via `setTimeout`; fires `onExpire` callback | LOW |
| `screenshot.js` | `blsi.Screenshot` | `captureVisibleTab` + canvas crop + clipboard write | LOW |
| `shortcut_handler.js` | `blsi.Shortcuts` | Single `keydown` capture-phase listener; O(actions) scan on every key press | LOW |
| `url_matcher.js` | `blsi.UrlMatcher` | Pattern matching and settings resolution on SPA URL changes | LOW |
| `storage_manager.js` | `blsi.Storage` | Message-passing proxy to background for all `chrome.storage.local` I/O | MEDIUM |
| `tab_privacy.js` | `blsi.TabPrivacy` | Replaces tab title with `…` — single DOM write on enable/disable | LOW |
| `shortcut_reserved.js` | `blsi.ShortcutReserved` | Static reserved-chord lookup at capture-UI time only | LOW |
| `shortcut_label.js` | `blsi.ShortcutLabel` | Platform-aware label rendering — executes at UI render time only | LOW |
| `action_registry.js` | `blsi.Actions` | Frozen action registry, read at init only | LOW |
| `constants.js` | `globalThis.blsi` | Frozen constants and settings builders, executed once at parse time | LOW |

---

## 3. Content Script Injection Details

**Injection timing:** `document_idle` — Chrome waits for `DOMContentLoaded` and defers until subresource loading is mostly complete. This means the extension does not block initial page paint, but its init runs after the DOM is fully available.

**Script count:** 19 JS files + 1 CSS file. Each file is a self-contained IIFE. The browser parses and evaluates them sequentially in the order declared in `manifest.json`. On a cold profile (first page load after extension install), parse and eval of all 19 files adds a fixed per-page overhead of approximately 15–40 ms depending on CPU tier.

**Cold-start I/O bottleneck:** `content_script.js` issues a `chrome.storage.local.get` call that reads four keys (`blur_items`, `blur_all_hosts`, `settings`, `blur_rules`) in a single round-trip to the background service worker. This IPC hop — background wake-up latency included — is the single largest contributor to init latency, typically 20–80 ms on a warm browser. The storage call is unavoidable; it is the data needed for the first reconcile.

**First reconcile:** Immediately after the storage read resolves, `_reconcile()` runs. If blur-all is active or stored blur items exist, this triggers `BlurEngine.handleSite()`, which performs a `querySelectorAll('*')` sweep, CSS injection, and `MutationObserver` setup. On large pages with many shadow roots this first reconcile can take 100–300 ms.

---

## 4. Critical Performance Paths

### 4.1 Cold-start init on a complex page

Triggered on every page navigation when `document_idle` fires. The sequence is: `chrome.storage.local.get` (4 keys) → `UrlMatcher.resolveSettings` (rule matching) → `_reconcile()` → `BlurEngine.handleSite()`. The storage round-trip involves a message to the service worker, which may itself be cold and must wake up. On a page with 5 000+ DOM nodes and multiple shadow roots, the subsequent `querySelectorAll('*')` pass in `stampElements` dominates. The measurable symptom is a 100–400 ms main-thread block on the first load, visible as a TTI spike and a brief style recalculation surge in DevTools timeline.

### 4.2 Blur-all toggle on a 10 000-element DOM

Triggered when the user presses Alt+Shift+B or the popup toggle. `_reconcile()` calls `BlurEngine.handleSite()`, which calls `handleDocument(settings, document)`. This runs `injectRules` (one style element write) followed by `stampElements`, which issues a single `querySelectorAll('*')` over the full document. Each element is tested against the active `CATEGORY_SELECTORS` tag set (O(1) Set lookup) and stamped with `data-bl-si-blur` if it passes a text-content check. For every shadow root discovered, `observeRoot` and another `stampElements` pass are scheduled. On a 10 000-element page with 10 shadow roots this can produce 10 000+ attribute writes and 10 `MutationObserver` instantiations in a single synchronous block. The symptom is a 200–600 ms main-thread freeze and a visible layout/recalc burst in the Performance panel.

### 4.3 PII scan on a 50 000-word page

Triggered when `AUTO_DETECT` is enabled (either `EMAIL=true` or `NUMERIC !== 'off'`). `PiiDetector.scan(rootEl, types)` creates a `TreeWalker(NodeFilter.SHOW_TEXT)` and collects all text nodes into an array before modifying the DOM (to avoid live-iterator invalidation). For each text node it runs up to two regular expressions (EMAIL with `@`-pre-filter, NUMERIC unconditionally in standard mode). Every match produces `splitText` calls and DOM insertions of `<span data-bl-si-pii>` elements. On a 50 000-word page (Wikipedia article), this creates tens of thousands of text-node splits. The symptom is a 300–800 ms main-thread block, a significant heap growth (~5–15 MB of new span nodes), and a visible style recalculation cascade as the browser re-renders the affected subtrees.

### 4.4 MutationObserver callback storm on interactive sites

When blur-all is active, `BlurEngine.observeRoot` attaches a `MutationObserver` to each document and shadow root with `childList: true, subtree: true`. On interactive sites (social feeds, real-time dashboards, SPAs) that insert hundreds of nodes per second, each batch triggers the observer callback, which must re-run `stampElements` on the added nodes. The observer is gated: it only runs when `_isPageBlurred` is true AND `_pickerActive` is false. Despite gating, on a news ticker or a WebSocket-driven feed, the callback can fire 20–60 times per second. Each invocation does a linear scan of the added-nodes list. The symptom is sustained high CPU (15–40% on a single core) and a widening heap from accumulated stamped nodes.

### 4.5 Hover reveal mouseover handler at 60 Hz

`reveal_controller` registers a capture-phase `mouseover` listener on `document`. On every event it calls `findBlurredTarget`, which walks `event.composedPath()` and calls `isVisuallyBlurred` on each ancestor until it finds a blurred element. `isVisuallyBlurred` itself checks for the `data-bl-si-blur` attribute, the `data-bl-si-pii` attribute, and then falls through to a CSS selector match against the active category tag set. On a blur-all page where most elements are blurred, every mouseover over a child element triggers a multi-level ancestor walk. At 60 Hz cursor movement this is ~60 DOM walks per second. The symptom is a measurable main-thread contribution of 2–8 ms per second, occasionally causing dropped frames if the walk hits deep DOMs (> 20 ancestors).

### 4.6 SPA navigation re-reconcile

`content_script` detects URL changes by comparing `location.href` to `lastUrl` on a `popstate` listener plus a `MutationObserver` on `document.title`. On each URL change it calls `UrlMatcher.resolveSettings(href, globalSettings, rules)`, which runs each stored URL rule's wildcard or regex pattern against the current URL. With 50 rules, this is 50 pattern matches per navigation. The result is then passed to `applyState`, which may trigger a full `_reconcile()` if the resolved settings differ from the previous page. On single-page apps like Gmail that navigate frequently, this reconcile loop runs multiple times per minute. The symptom is a 20–100 ms main-thread burst on each client-side navigation, plus the overhead of tearing down and re-attaching `MutationObserver` instances across shadow roots.

### 4.7 Shadow DOM traversal

`BlurEngine.stampElements` performs a `querySelectorAll('*')` and for each element checks `el.shadowRoot`. When a shadow root is discovered, `shadowCb(el.shadowRoot)` is called synchronously, which dispatches `handleDocument` for that shadow root — injecting its own `<style>` element and running another `stampElements` pass inside. If that shadow root itself contains shadow hosts (nested custom elements, common in component frameworks like Lit or Salesforce Lightning), the traversal recurses. On a page with 50 shadow roots the total element visits can exceed the flat DOM size by 3–5×. `observeRoot` then installs a `MutationObserver` on each root, multiplying the observer count. The symptom is a super-linear init time relative to element count and an elevated baseline memory footprint from multiple injected style elements and observer handles.

### 4.8 Picker drag at 60 Hz

During sticky zone drawing in `picker.js`, a `mousemove` listener is registered at capture phase on `document`. On every event the preview `<div class="bl-si-zone-drawing">` receives four inline style updates (`left`, `top`, `width`, `height`) computed from current cursor position minus drag origin. At 60 Hz cursor movement this is 240 style property writes per second, each of which triggers a browser style invalidation. The zone div is `position: fixed` during drawing, so each write causes the browser to recalculate the containing block but does not force a full layout. The symptom is a modest 5–15 ms/s CPU contribution during drag and occasional 1–2 ms frame jank on low-end devices.

---

## 5. Known Performance Trade-offs

| Trade-off | Detail |
|---|---|
| PII span heap overhead | Each PII match inserts a `<span data-bl-si-pii>` node. On a 100 000-word page, NUMERIC standard mode may produce 2 000–8 000 spans adding 5–10 MB to the DOM heap. This heap cost persists until `clear()` is called. |
| Sticky zone restore on every load | Sticky zones stored in `chrome.storage.local` are read on every page load and re-created as overlay `<div>` elements. With 20 saved zones, this adds ~20 overlay appends per page load after the storage read. |
| MutationObserver gating | The observer only runs when blur-all is active AND the picker is closed (gated by `_isPageBlurred && !_pickerActive`). This prevents 60 Hz callbacks on idle pages. Removing the gate would make mutation handling continuous — do not do this without re-benchmarking on social media feeds. |
| CSS-only blur via `filter: blur()` | Applied as a CSS class (`bl-si-blurred`) and data-attribute rule rather than a canvas overlay. This is GPU-accelerated and works on DRM video. The trade-off is that `filter` creates a stacking context, which breaks `position: fixed` and `position: sticky` descendants inside blurred containers. |
| Single `querySelectorAll('*')` sweep | `stampElements` uses one broad selector sweep rather than per-category queries, which minimises the number of DOM traversals. The cost is visiting every element — including non-target ones — on every reconcile. |

---

## 6. Suggested Test Pages

| Page Type | Example Site | Feature Stressed | Why |
|---|---|---|---|
| Text-heavy article | Wikipedia (any long article) | PII detector (NUMERIC standard mode), TEXT category blur-all | 20 000–100 000 words, dense text nodes, thousands of `<p>`, `<span>`, `<a>` elements |
| Image gallery / product grid | Any e-commerce product listing | MEDIA category blur-all, reveal hover | Hundreds of `<img>` elements; tests GPU rasterization under blur filter |
| Form-heavy page | GitHub sign-in, Stripe checkout | FORM category, picker dynamic mode | Multiple `<input>`, `<select>`, `<button>` elements; tests ARIA role matching |
| SPA with client-side routing | Gmail | URL rule matching, observer attach/detach cycle, PII scan on navigation | Frequent client-side navigations; high DOM mutation rate from message list updates |
| Web-components / shadow DOM | Salesforce Lightning, any Lit-based app | Shadow root traversal, `injectRules` per root, observer per root | Deep shadow DOM nesting; stress-tests `stampElements` recursion and multi-root style injection |
| Mixed-content news site | BBC, The Guardian | Combined category blur-all (TEXT + MEDIA + STRUCTURE), PII scan | Dense mixed content; realistic combined load for all active categories simultaneously |
| Real-time feed | Twitter/X timeline, Reddit | MutationObserver storm, re-stamp on dynamic insert | Continuous DOM insertion from infinite scroll; tests observer callback frequency under sustained mutation |
