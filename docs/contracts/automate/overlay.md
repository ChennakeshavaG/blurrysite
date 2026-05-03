# automate/overlay Contract

## Overview

Viewport-covering frosted blur overlay used by automate-driven blur (idle / tab-switch / screen-share). A single `<div id="bl-si-automate-overlay">` mounted on `document.body` with inline `position: fixed; inset: 0; z-index: 2147483640`.

This is the render path for **automate intent only**. Manual blur-all, pick-blur, and PII detection continue to use the existing stamp + CSS-injection engine; their granularity (per-element, per-text-node, per-category) is finer than what an overlay can express.

Why an overlay primitive instead of reusing the stamp + CSS engine for automate:
- Cheap: one DOM element vs `querySelectorAll('*')` + per-element data-attribute stamping + per-shadow-root CSS injection.
- Privacy-positive: covers everything beneath, including canvas / video / iframes / shadow DOM, regardless of category settings.
- Symmetric to intent: automate says "hide this page now"; an opaque-ish curtain is more honest than a CSS filter that leaves artifacts (DRM video, transformed ancestors, etc.).

**Single fixed style — no parameters.** The overlay renders a pure frosted curtain (40px backdrop-filter blur, no tint). The user's blur_mode / blur_radius / color preferences are deliberately NOT consulted: automate is privacy-strongest by design, and threading those settings through to a privacy curtain creates a footgun where a user-chosen "blur 4px" defeats the privacy intent.

Loaded in CONTENT context only — never in background.

Exposed as `blsi.Automate.Overlay` (IIFE — no ES module syntax).

## Public API

### `init()` → void

Idempotent initialization. Currently a no-op — the overlay does not pre-mount on init. Reserved for future hooks (e.g., subscribing to `chrome.storage.onChanged` directly if we move overlay control out of the engine).

Safe to call multiple times.

### `show()` → void

Mounts the overlay onto `document.body` (if not already mounted). Takes no arguments — the visual style is fixed.

Side effects:
- Creates the `<div>` if not present, applies all styles inline (no CSS injection — page CSS cannot disable our z-index, pointer-events, or backdrop-filter because every property uses `setProperty(name, value, 'important')`).
- Stamps `data-bl-si-extension-ui="1"` on the element so existing blur engines exclude it.
- Stamps `aria-hidden="true"` so screen readers ignore it.
- The overlay captures pointer events while visible (so the page beneath is non-interactive).

Edge cases:
- `document.body` not yet present at call time → silent skip; caller responsible for retry. (DOM-ready guard expected from caller.)
- Called twice in a row → second call is a no-op (the element already exists; we hold the internal reference).

### `hide()` → void

Removes the overlay from the DOM. Idempotent — calling on a hidden overlay is a no-op.

After `hide()`, the next `show()` re-creates the element from scratch (no stale state retained).

### `isVisible()` → boolean

Returns `true` iff the overlay element is currently in the DOM. Synchronous.

### `destroy()` → void

Hides the overlay and clears `_initialized`. After destroy, `init()` must be called again before `show()` will work as intended (in current implementation `show()` itself calls `init()` if needed — so this is mostly a cleanup hook for tests).

## Fixed style

| Property | Value | Why |
|---|---|---|
| `backdrop-filter: blur(40px)` | deep blur | heavy obscuration, page motion still hints through |
| `background: transparent` | no tint | pure frosted glass — no dark overlay; backdrop-filter alone provides sufficient obscuration |
| `position: fixed; inset: 0; 100vw × 100vh` | viewport cover | independent of page scroll/layout |
| `z-index: 2147483640` | below toast (`2147483646`) and picker toolbar (`2147483647`) | overlay can't cover toast actions or picker UI |
| `pointer-events: auto` | block clicks | page beneath is non-interactive while overlay is up |

Constants are private to the IIFE. Changing them is a single-place edit; no public knob.

## DOM contract

The overlay element:
- `id="bl-si-automate-overlay"` — predictable for selector queries; tests can find it via `document.getElementById`.
- `aria-hidden="true"`
- `data-bl-si-extension-ui="1"` — guards against the blur engine's `_isExtensionUI` filter accidentally re-blurring our overlay.
- All styles inline via `setProperty(..., 'important')`. The element does not depend on `styles/content.css`.

## Invariants

- Only one overlay element per document (we hold the reference internally).
- The overlay is always above page content but below the toast (`2147483646`) and picker toolbar (`2147483647`) — `z-index: 2147483640` enforces this.
- Inline styles use `!important` for every property — page CSS cannot override our positioning, z-index, or backdrop-filter.
- `hide()` followed by `show()` produces a fresh element; no stale event listeners or attributes carry over.
- The overlay does not register any DOM event listeners of its own (no click handlers, no keydown handlers).
- The overlay does not read `blsi.Model` / settings / resolve output. It has no parameters and no settings dependency.
- The exported `Overlay` object is frozen.

## Edge cases / gotchas

- **Page CSP**: `style-src` directives do NOT apply to inline styles set via DOM API (`element.style.setProperty`). Overlay works on strict-CSP pages.
- **`backdrop-filter` support**: Chrome 76+ supports it natively. With transparent background, older browsers without backdrop-filter support would see no obscuration — acceptable since our minimum supported Chrome version is well above 76.
- **`100vh` on iOS Safari**: `100vh` includes the URL bar height even when scrolled; minor visual gap possible. Acceptable since iOS Safari isn't a primary target. If we later care, switch to `100dvh` (Chrome 108+, Safari 15.4+).
- **Print stylesheets**: the overlay carries no `@media print` exclusion. If user prints while automate-blurred, the overlay prints too. Privacy-positive default; matches the existing print rules in `content.css` that preserve blur in print output.
- **`document.body` swap**: rare frameworks replace `document.body` after init. Our reference becomes stale — the overlay is orphaned. Not a known issue today; would need a `body` mutation watcher to re-mount.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `engine.js` (handleSite) | `show()` | When `resolved.automate_blur_active` |
| `engine.js` (handleSite) | `hide()` | When automate state clears (idle returns to active, tab visible, share end) or `enabled === false` |
| `content_script.init()` | `init()` | Once at startup (currently no-op; idempotent so harmless) |

`engine.handleSite` reads `resolved.automate_blur_active` and decides show/hide. The overlay does not subscribe to storage events itself — engine reconciles.

## Test strategy

- Mock `document.body` in jsdom (already present).
- Cover: `show` mounts, `show` is idempotent, `hide` removes, `isVisible` reflects state, the fixed frosted style is applied (backdrop-filter + tint), `data-bl-si-extension-ui` is stamped, `aria-hidden` is stamped, base positioning + z-index match the contract.
- Visual / integration: not part of unit tests; rely on manual QA for the actual frosted rendering.
