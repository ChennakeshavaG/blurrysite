# Blur Engine — Overview

`src/blur_engine.js` is the central module responsible for every visual blurring operation in Blurry Site. It is an IIFE that exports a single object as `blsi.BlurEngine`. This document is the entry point — it maps the full system at a high level and directs you to the right sub-document for deep dives.

---

## What the Blur Engine Does

The blur engine manages three independent blur subsystems that coexist on the same page without CSS conflicts. It is responsible for:

1. **Blur-all** — applies a page-wide blur by injecting CSS tag-based selectors into the document (and every discovered shadow root), and stamping `data-bl-si-blur` onto text-check elements that pass a meaningful-content gate.
2. **Pick-blur** — applies targeted blur to individual user-selected elements or rectangular zones, tracked as `data-bl-si-pick-blur` items in storage.
3. **PII blur** — renders PII-detection spans (placed by `pii_detector.js`) via a separate `<style>` injection, independent of blur-all lifecycle.

The engine is the *sole owner* of DOM blur state. `content_script.js` resolves settings from storage and calls `handleSite(settings)` — the engine does the rest.

---

## Three Independent Blur Subsystems

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         PAGE DOM                                         │
│                                                                          │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐ │
│  │     BLUR-ALL         │  │     PICK-BLUR        │  │   PII BLUR     │ │
│  │                      │  │                      │  │                │ │
│  │ Tag CSS selectors     │  │ [data-bl-si-pick-   │  │ [data-bl-si-   │ │
│  │ (alwaysBlur):         │  │  blur] attribute    │  │  pii] spans    │ │
│  │  h1,h2,p,img,etc.    │  │                      │  │  (text nodes)  │ │
│  │                      │  │ Two forms:           │  │                │ │
│  │ [data-bl-si-blur]     │  │  • Dynamic item      │  │ Placed by:     │ │
│  │ attribute (textCheck):│  │    (element sel.)    │  │  pii_detector  │ │
│  │  div,span,a,etc.     │  │  • Sticky zone       │  │  .js           │ │
│  │  (with content)      │  │    (rect overlay)    │  │                │ │
│  │                      │  │                      │  │ CSS injected   │ │
│  │ Lifecycle:           │  │ Lifecycle:           │  │ by engine:     │ │
│  │  ON ↔ OFF via        │  │  persists even when  │  │  injectPii     │ │
│  │  engage     │  │  blur-all is OFF     │  │  Rules()       │ │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**Attribute ownership — each element carries at most one blur attribute:**

| Attribute | Owner | CSS Rule Source |
|---|---|---|
| `[data-bl-si-blur]` | blur-all engine (stampElements) | Injected `#bl-si-blur-styles` + static `content.css` fallback |
| `[data-bl-si-pick-blur]` | picker / context menu / zone overlay | Injected `#bl-si-pick-blur-styles` + static `content.css` fallback |
| `[data-bl-si-pii]` | `pii_detector.js` | Injected `#bl-si-pii-styles` |

---

## CSS Layer Stack

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       VISUAL RENDERING (browser)                         │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ applied CSS
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌─────────────────┐     ┌───────────────────────┐   ┌───────────────────┐
│  styles/        │     │  <style               │   │  <style           │
│  content.css    │     │    id="bl-si-blur-     │   │    id="bl-si-     │
│  (static,       │     │    styles">            │   │    pii-styles">   │
│  always loaded) │     │  (injected by engine   │   │  (injected by     │
│                 │     │   when blur-all ON)    │   │   engine when     │
│ Covers:         │     │                       │   │   PII is ON)      │
│  • data-attr    │     │ Covers:               │   │                   │
│    blur for all │     │  • tag selectors      │   │ Covers:           │
│    3 systems    │     │    (alwaysBlur)       │   │  • [data-bl-si-   │
│  • reveal when  │     │  • [data-bl-si-blur]  │   │    pii] spans     │
│    blur-all OFF │     │  • reveal overrides   │   │  • reveal for PII │
│  • zone overlay │     │                       │   │                   │
│    base styles  │     │  <style               │   └───────────────────┘
│  • picker UI    │     │    id="bl-si-pick-    │
│  • toolbar/toast│     │    blur-styles">       │
└─────────────────┘     │  (only for            │
                        │   frosted/color modes)│
                        │                       │
                        │ Covers:               │
                        │  • [data-bl-si-       │
                        │    pick-blur] in       │
                        │    frosted/color mode │
                        └───────────────────────┘

                   ┌──────────────────────────────────┐
                   │  :root CSS Custom Properties      │
                   │  (set by content_script.js)       │
                   │  ─────────────────────────────── │
                   │  --bl-si-radius         (blur px) │
                   │  --bl-si-highlight-color          │
                   │  --bl-si-transition-duration      │
                   │  --bl-si-redaction-color          │
                   └──────────────────────────────────┘

                   ┌──────────────────────────────────┐
                   │  SVG Filter (frosted mode only)   │
                   │  <svg id="bl-si-svg-filters">     │
                   │  feTurbulence                     │
                   │  → feDisplacementMap              │
                   │  → feGaussianBlur (stdDeviation)  │
                   └──────────────────────────────────┘
```

---

## Z-index Layering

| Z-index | Element | Notes |
|---|---|---|
| `2147483647` | Picker toolbar pill, tooltip | Always on top |
| `2147483646` | Toast notifications | Below toolbar |
| `2147483645` | Zone drawing preview (sticky picker) | Active while drawing |
| `2147483641` | Zone name labels | Above zone overlays |
| `2147483640` | Zone overlays (sticky blur) | High enough to beat most page content |
| `1` | Canvas overlay (legacy, unused in current impl) | Above normal content |
| `0` | Page content baseline | |

---

## Key Design Principles

### 1. CSS-only blurring — no canvas overlays, no DOM injection
Every element (text, video, image, generic) is blurred purely via CSS `filter`. No canvas overlays, no `requestAnimationFrame` loops, no text-node wrapping spans. CSS `filter: blur()` on a parent automatically blurs all descendants, including DRM-protected video (CSS filter doesn't extract pixels, so DRM is unaffected).

### 2. CSS custom property propagation
Blur radius changes propagate instantly via `--bl-si-radius` on `:root`. The engine never sets this property; `content_script.applySettingsToDom()` owns it. This means changing blur radius in gaussian mode requires zero DOM manipulation — the CSS engine handles it at repaint time.

### 3. Deferred idle stamping
The expensive `querySelectorAll('*')` pass (for text-check elements) is always deferred to `requestIdleCallback`. CSS injection (`injectRules`) is synchronous so always-blur tags are covered immediately. MutationObserver callbacks only collect node references synchronously; the actual stamp work also runs in `requestIdleCallback`.

### 4. WeakMap-keyed observers
`MutationObserver` instances are stored in a `WeakMap` keyed by the root (`document` or `ShadowRoot`). When a shadow host is removed from DOM and GC'd, the WeakMap entry auto-cleans — no manual bookkeeping needed.

### 5. Mutual exclusivity of blur systems
Three CSS systems can co-exist on one element but each *owns its elements exclusively*. The `EXCLUDE` `:not()` chain appended to every tag selector prevents blur-all CSS from matching elements owned by pick-blur or PII. The `stampElements` guard skips elements already carrying a competing blur attribute.

### 6. Single orchestration entry point
All production blur state changes flow through `handleSite(settings)`. The function is a mutex-guarded async function that diffs settings against prior state and dispatches only the minimal DOM work needed. Callers never call `injectRules`, `stampElements`, or `observeRoot` directly.

### 7. Data-attribute over class
Blur state uses `data-bl-si-blur` attributes instead of class names. This is intentional: rendering frameworks (React, Vue, Angular) aggressively diff and replace className, but typically leave `dataset` alone. Using data attributes makes blur survive React re-renders.

---

## Critical Source Files

| File | Role |
|---|---|
| `src/blur_engine.js` | Core blur engine — all blur lifecycle |
| `src/content_script.js` | Orchestrator — init, settings, message routing |
| `src/picker.js` | Picker UI — element targeting + zone drawing |
| `src/reveal_controller.js` | Reveal system — hover/click reveal |
| `src/selection_blur.js` | Selection-based blur (parallel system) |
| `src/pii_detector.js` | PII text scanning (places `[data-bl-si-pii]` spans) |
| `src/fonts.js` | Embedded WOFF2 fonts for censored/starred modes |
| `styles/content.css` | Static CSS — fallback rules + picker UI + zone overlays |

---

## Document Reading Guide

| Question | Read |
|---|---|
| How does blur-all CSS work? | `01-css-layer.md` |
| Which elements get blurred and why? | `02-element-stamping.md` |
| How does blur work inside web components? | `03-shadow-dom.md` |
| How does `handleSite()` decide what to do? | `04-orchestration.md` |
| How does blur react to dynamically added content? | `05-mutation-observer.md` |
| How does the picker create zone overlays? | `06-picker-integration.md` |
| How does hover/click reveal work? | `07-reveal-system.md` |
| How does PII blur relate to blur-all? | `08-pii-system.md` |
| What is the difference between gaussian, frosted, redacted, censored? | `09-blur-modes.md` |
| How does selection-based blur work? | `10-selection-blur.md` |
| What are the internal state variables? | `11-internals.md` |
| How does the content script initialize everything? | `12-content-script-flow.md` |
