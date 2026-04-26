# fonts Contract

## Overview

Provides precomputed `@font-face` CSS strings for the two text-masking fonts used by `blur_engine.js`. Each constant is a complete CSS at-rule string with the font URL resolved at module-init time via `chrome.runtime.getURL()`. No functions — the module is pure data.

## Public API

### DISC_FONT_FACE (string constant)

**What**: Complete `@font-face` CSS string declaring the `"bl-si-censored-disc"` font family.  
**Value**: `@font-face { font-family: "bl-si-censored-disc"; src: url("<ext-url>/fonts/disc.woff2") format("woff2"); font-display: block; }`  
**Used by**: `blur_engine.injectRules()` for blur-all `censored` mode.  
**Font source**: noppa/text-security v3.2.0 (OFL-1.1). Maps every Unicode codepoint to a filled disc (●).

### ASTERISK_FONT_FACE (string constant)

**What**: Complete `@font-face` CSS string declaring the `"bl-si-starred-asterisk"` font family.  
**Value**: `@font-face { font-family: "bl-si-starred-asterisk"; src: url("<ext-url>/fonts/asterisk.woff2") format("woff2"); font-display: block; }`  
**Used by**: `blur_engine.injectPiiRules()` for PII `starred` mode.  
**Font source**: Custom build via fontTools (OFL-1.1). Maps every BMP codepoint to a 6-arm asterisk via cmap format 4.

## Invariants

- Both constants are computed eagerly at module load — `chrome.runtime.getURL()` is called once per constant when the IIFE runs.
- `font-display: block` is intentional — prevents flash of invisible text during blur reveal when the font file is fetched.
- Font files must be declared in `manifest.json` `web_accessible_resources` so content scripts can reference them via `chrome.runtime.getURL()`.
- The module is frozen: `Object.freeze({ DISC_FONT_FACE, ASTERISK_FONT_FACE })`.
