# automate/overlay Contract

## Overview

Viewport-covering blur overlay primitive used by automate-driven blur (idle / tab-switch / screen-share). A single `<div id="bl-si-automate-overlay">` mounted on `document.body` with inline `position: fixed; inset: 0; z-index: 2147483646`.

This is the render path for **automate intent only**. Manual blur-all, pick-blur, and PII detection continue to use the existing stamp + CSS-injection engine; their granularity (per-element, per-text-node, per-category) is finer than what an overlay can express.

Why an overlay primitive instead of reusing the stamp + CSS engine for automate:
- Cheap: one DOM element vs `querySelectorAll('*')` + per-element data-attribute stamping + per-shadow-root CSS injection.
- Privacy-positive: covers everything beneath, including canvas / video / iframes / shadow DOM, regardless of category settings.
- Symmetric to intent: automate says "hide this page now"; an opaque curtain is more honest than a CSS filter that leaves artifacts (DRM video, transformed ancestors, etc.).
- Cheap to update: changing color/opacity/blur is a CSS property update on one element. No reflow of the page.

Loaded in CONTENT context only — never in background.

Exposed as `blsi.Automate.Overlay` (IIFE — no ES module syntax).

## Public API

### `init()` → void

Idempotent initialization. Currently a no-op — the overlay does not pre-mount on init. Reserved for future hooks (e.g., subscribing to `chrome.storage.onChanged` directly if we move overlay control out of the engine).

Safe to call multiple times.

### `show(options)` → void

Mounts the overlay onto `document.body` (if not already mounted) and applies the requested visual mode.

Params (`options` object, all optional):
- `mode: 'solid' | 'frosted' | 'color'` (default `'solid'`)
- `color: '#RRGGBB'` — hex color (default `'#000000'`); used as the tint/background base.
- `opacity: number` 0–1 (default `1`); clamped to `[0, 1]`.
- `blur_radius: number` (default `16`); only used when `mode === 'frosted'`.

Mode behavior:
- `solid` — opaque rectangle. `background: rgba(color, opacity)`. Strongest privacy, nothing leaks through.
- `frosted` — `backdrop-filter: blur(blur_radius)px` + translucent tint (opacity capped at 0.6 so the blur is visible).
- `color` — solid rectangle in the user's chosen color/opacity. Same as `solid` but semantically configurable; matches `pick_blur_modes.color`.

Side effects:
- Creates the `<div>` if not present, applies all base styles inline (no CSS injection — page CSS cannot disable our z-index or pointer-events because every property uses `setProperty(name, value, 'important')`).
- Stamps `data-bl-si-extension-ui="1"` on the element so existing blur engines exclude it.
- Stamps `aria-hidden="true"` so screen readers ignore it.
- The overlay captures pointer events while visible (so the page beneath is non-interactive).

Edge cases:
- `document.body` not yet present at call time → silent skip; caller responsible for retry. (DOM-ready guard expected from caller.)
- Called twice in a row with same options → second call re-applies styles, no-op effectively.
- Called with new options while already visible → updates the existing element without remounting (equivalent to `update`).

### `update(options)` → void

Re-applies visual options to an already-mounted overlay. If the overlay is NOT mounted, falls through to `show(options)` so callers can use `update` as the only setter once they've decided overlay should be visible.

Params: same shape as `show`. Provided keys overwrite the last-applied options; missing keys retain the last value.

### `hide()` → void

Removes the overlay from the DOM. Idempotent — calling on a hidden overlay is a no-op.

After `hide()`, the next `show()` re-creates the element from scratch (no stale state retained).

### `isVisible()` → boolean

Returns `true` iff the overlay element is currently in the DOM. Synchronous.

### `destroy()` → void

Hides the overlay and clears internal state (`_initialized`, `_last_options`). After destroy, `init()` must be called again before `show()` will work as intended (in current implementation `show()` itself calls `init()` if needed — so this is mostly a cleanup hook for tests).

## DOM contract

The overlay element:
- `id="bl-si-automate-overlay"` — predictable for selector queries; tests can find it via `document.getElementById`.
- `aria-hidden="true"`
- `data-bl-si-extension-ui="1"` — guards against the blur engine's `_isExtensionUI` filter accidentally re-blurring our overlay.
- All styles inline via `setProperty(..., 'important')`. The element does not depend on `styles/content.css`.

CSS properties applied:
- `all: initial !important` — neutralizes inherited page CSS.
- `position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important`
- `z-index: 2147483646 !important` (one below the picker toolbar at `2147483647`)
- `pointer-events: auto !important; user-select: none !important; display: block !important`
- `background: rgba(...) !important` — derived from `color` + `opacity`.
- `backdrop-filter` / `-webkit-backdrop-filter`: only set in `frosted` mode; removed otherwise.

## Invariants

- Only one overlay element per document (`getElementById` guards against duplicates indirectly because we hold the reference internally).
- The overlay is always above page content but below the picker toolbar — `z-index: 2147483646` enforces this.
- Inline styles use `!important` for every property — page CSS cannot override our positioning or z-index.
- `hide()` followed by `show()` produces a fresh element; no stale event listeners or attributes carry over.
- The overlay does not register any DOM event listeners of its own (no click handlers, no keydown handlers).
- The exported `Overlay` object is frozen.

## Edge cases / gotchas

- **Page CSP**: `style-src` directives do NOT apply to inline styles set via DOM API (`element.style.setProperty`). Overlay works on strict-CSP pages.
- **`backdrop-filter` support**: Chrome 76+ supports it natively; older browsers fall back to opaque tint (still privacy-preserving). No fallback code needed for our minimum supported Chrome.
- **`100vh` on iOS Safari**: `100vh` includes the URL bar height even when scrolled; minor visual gap possible. Acceptable since iOS Safari isn't a primary target. If we later care, switch to `100dvh` (Chrome 108+, Safari 15.4+).
- **Print stylesheets**: the overlay carries no `@media print` exclusion. If user prints while automate-blurred, the overlay prints too. Privacy-positive default; matches the existing print rules in `content.css` that preserve blur in print output.
- **`document.body` swap**: rare frameworks replace `document.body` after init. Our reference becomes stale — the overlay is orphaned. `show()` checks via `_el.parentNode` indirectly through `isVisible()`; if a future caller hits this, we may need to re-mount on `body` mutation. Not a known issue today.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `engine.js` (handleSite) | `show({mode, color, opacity, blur_radius})` | When `resolved.automate_blur_active && resolved.engage` |
| `engine.js` (handleSite) | `hide()` | When automate state clears (idle returns to active, tab visible, share end) |
| `content_script.init()` | `init()` | Once at startup (currently no-op) |
| `engine.js` (teardown) | `hide()` | On extension disable / `unblurAll` |

`engine.handleSite` reads `resolved.automate_blur_active` and decides show/hide. The overlay does not subscribe to storage events itself — engine reconciles.

## Test strategy

- Mock `document.body` in jsdom (already present).
- Cover: `show` mounts, `show` is idempotent, `update` mutates without remount, `hide` removes, `isVisible` reflects state, mode switches (solid → frosted → color) update the right CSS properties, `_rgba` produces correct strings for valid/invalid hex inputs, `data-bl-si-extension-ui` is stamped (so the marker engine ignores it).
- Visual / integration: not part of unit tests; rely on manual QA for opacity / backdrop-filter rendering.
