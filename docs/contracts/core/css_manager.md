# core/css_manager.js — contract

Three independent style-injection systems (blur-all, pick-blur, PII) plus the always-blur SVG filter and the selector cache that other engine sub-modules read from.

## Module identity

- File: `src/core/css_manager.js`
- Global: `blsi.CssManager`
- Load order: after `categories.js`, before `marker_engine.js`.

## Public API

| Method | Returns | Notes |
|---|---|---|
| `injectRules(root, categories, mode)` | — | Idempotent (removes prior style first). Targets `root.head ?? root` so it works for both document and shadow roots. Calls `blsi.MarkerEngine.rebuildTextCheckSet(cats)` if MarkerEngine is present. Frosted mode also injects the SVG filter into the same root. |
| `removeRules(root)` | — | Removes the `#bl-si-blur-styles` element from `root.head ?? root`. No-op if absent. |
| `isBlurAllActive()` | `boolean` | Stateless DOM check — `document.head.querySelector('#bl-si-blur-styles')`. |
| `injectPickBlurRules(root, type, color)` | — | Injects `#bl-si-pick-blur-styles`. `type === 'blur'` is a no-op (the static `content.css` rule covers it). `'frosted'` adds an SVG filter ref; `'color'` writes RGBA + `bl-si-zone-overlay` overrides. |
| `removePickBlurRules(root)` | — | Removes `#bl-si-pick-blur-styles`. |
| `injectPiiRules(mode, color)` | — | Document-only (PII spans always live in main document). Modes: `'blur'`, `'frosted'`, `'redacted'`, `'starred'`. |
| `removePiiRules()` | — | Removes `#bl-si-pii-styles`. |
| `ensureSvgFilter(root)` | — | Creates / replaces the `<svg>` filter element in `root` (or `document.body` for the main document). Always rebuilds — Chrome's filter cache is not reliably invalidated by mutating `feGaussianBlur` in place. |
| `getSelectors(categories)` | `{ key, alwaysBlurSelector, textCheckSelector, alwaysBlurTags, textCheckTags, tagSet, roleSet }` | Memoised by category fingerprint; rebuilds on key miss via internal `buildSelectors`. |
| `getLastSelectorCache()` | object \| null | Read-only accessor for the most recently computed cache entry. Used by `MarkerEngine.isBlurred` / `isVisuallyBlurred`. |

`SVG_FILTER_ID` is also exposed so `engine.js teardown` can remove the SVG filter element.

## State

| Var | Default | Mutator |
|---|---|---|
| `selectorCache` | `null` | `getSelectors` populates on key miss; `getLastSelectorCache` reads it without mutation. |

## Cross-module reads

- `blsi.Categories.{CATEGORY_SELECTORS, CATEGORY_ORDER, DEFAULT_CATS}`
- `blsi.MarkerEngine.rebuildTextCheckSet` (looked up at call time inside `injectRules`; absent at IIFE init)
- `blsi.Fonts.{DISC_FONT_FACE, ASTERISK_FONT_FACE}` (font-face strings for redacted / starred modes)
- `blsi.{blur_modes, pii_modes, pick_blur_modes}` enums

## Edge cases

- **Shadow roots**: `injectRules(shadowRoot, …)` works because `root.head ?? root` falls back to the shadow root itself. The same SVG filter gets injected into each shadow root so `url(#bl-si-frosted-filter)` resolves within scope.
- **Frosted mode + dynamic radius**: `--bl-si-radius` is a CSS var on `:root`; the SVG filter's `feGaussianBlur` reads it via `_readCssRadius()` at injection time and falls back to `4`. The CSS var is set by `engine.js _applyCssVars` before `injectRules` runs.
- **Reveal cascade**: `injectRules` always pushes `[data-bl-si-reveal] [data-bl-si-blur]`, `…[data-bl-si-pick-blur]`, and `…[data-bl-si-pii]` overrides AFTER the blur rules so source order wins for `!important` at equal specificity.
- **EXCLUDE chain**: every always-blur tag selector is suffixed with `:not(#bl-si-picker-toolbar):not(.bl-si-toast):not(.bl-si-toolbar):not(#bl-si-svg-filters):not([data-bl-si-reveal]):not([data-bl-si-pick-blur]):not([data-bl-si-pii])` to keep extension UI untouched and let competing blur systems own their elements.

## Why this module exists (Why)

Three CSS systems ride the same cascade and use the same exclusion chain to coexist. Centralising them avoids subtle specificity bugs (root cause of past dual-blur incidents). The selector cache lives here because every `injectRules` call needs it AND `MarkerEngine` queries it.

## How to apply (How)

- Adding a new blur-all mode: extend `injectRules` `blurDecl` branch only. `EXCLUDE` already excludes every competing system.
- Adding a new competing blur system (new `data-bl-si-*` attribute): add `:not([data-bl-si-newattr])` to `EXCLUDE`, add stamp guard in `MarkerEngine`, add reveal override in both `injectRules` and `content.css`.
