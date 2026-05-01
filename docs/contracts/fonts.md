# fonts Contract

## Overview

Provides the two text-masking fonts used by `core/css_manager.js` for the `censored` (blur-all) and `starred` (PII) modes. Two delivery paths so a strict page CSP (`font-src`) cannot silently break the modes:

1. **`@font-face` URL strings** — `DISC_FONT_FACE` / `ASTERISK_FONT_FACE`. Synchronous, injected into the same `<style>` block as the `font-family` rule. Cheap, but blocked when page CSP forbids `chrome-extension://` in `font-src`.
2. **`loadFonts()`** — fetches the woff2 binaries from the extension origin (privileged content-script context) and registers `FontFace` objects in `document.fonts`. Bypasses page CSP because the font payload never goes through `@font-face` URL resolution in the page.

`content_script.init()` calls `loadFonts()` (fire-and-forget) before any blur work runs, so by the time `[data-bl-si-pii]` / `[data-bl-si-blur]` font-family rules render, the fonts are usually already registered.

## Public API

### DISC_FONT_FACE (string constant)

**What**: Complete `@font-face` CSS string declaring the `"bl-si-censored-disc"` font family.  
**Value**: `@font-face { font-family: "bl-si-censored-disc"; src: url("<ext-url>/fonts/disc.woff2") format("woff2"); font-display: block; }`  
**Used by**: `core/css_manager.js → injectRules()` for blur-all `censored` mode.  
**Font source**: noppa/text-security v3.2.0 (OFL-1.1). Maps every Unicode codepoint to a filled disc (●).

### ASTERISK_FONT_FACE (string constant)

**What**: Complete `@font-face` CSS string declaring the `"bl-si-starred-asterisk"` font family.  
**Value**: `@font-face { font-family: "bl-si-starred-asterisk"; src: url("<ext-url>/fonts/asterisk.woff2") format("woff2"); font-display: block; }`  
**Used by**: `core/css_manager.js → injectPiiRules()` for PII `starred` mode.  
**Font source**: Custom build via fontTools (OFL-1.1). Maps every BMP codepoint to a 6-arm asterisk via cmap format 4.

### loadFonts()

**What**: Fetches both woff2 binaries via `fetch(chrome.runtime.getURL(...))`, wraps each in a `FontFace` object with `display: 'block'`, awaits `FontFace.load()`, and adds the loaded face to `document.fonts`. Idempotent — second and later calls return the same cached promise.  
**Params**: none.  
**Returns**: `Promise<void>`. Resolves once both fonts have been processed (success or failure). Never rejects.  
**Side effects**: Mutates `document.fonts` by adding two FontFace entries. No DOM mutation.  
**Edge cases**:
- No-op when `FontFace`, `document.fonts`, or `fetch` is unavailable (test environments / very old browsers) — returns a resolved promise.
- Per-font failures (CSP-blocked fetch, network error, invalid font binary) are swallowed; the `@font-face` URL string remains as the fallback path.
- Caller doesn't need to await — the function fires-and-forgets safely from `content_script.init()`.

## Invariants

- Both `@font-face` constants are computed eagerly at module load — `chrome.runtime.getURL()` is called once per constant when the IIFE runs.
- `font-display: block` is intentional in both delivery paths — prevents flash of invisible text during blur reveal while the font is loading.
- Font files must be declared in `manifest.json` `web_accessible_resources` so the extension URL is resolvable from both the `@font-face` URL path and the `loadFonts()` fetch path.
- The module is frozen: `Object.freeze({ DISC_FONT_FACE, ASTERISK_FONT_FACE, loadFonts })`.
- `loadFonts()` is the only mutable surface the module exposes; the FontFace registration is effectively a one-shot global side-effect on `document.fonts`.
