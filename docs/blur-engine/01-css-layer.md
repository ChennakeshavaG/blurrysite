# Blur Engine — CSS Layer

The blur engine uses a layered CSS architecture: one static stylesheet loaded unconditionally, and up to three injected `<style>` elements created dynamically. This document explains every CSS layer in detail — what goes in each, when it's created, and how they interact.

---

## Layer 1: `styles/content.css` (Static, Always Loaded)

This stylesheet is injected into every page via `manifest.json` `content_scripts`. It is *always present* regardless of blur state. It provides:

### CSS Custom Properties (`:root` defaults)

```css
:root {
  --bl-si-radius: 10px;              /* blur amount — overridden by content_script */
  --bl-si-highlight-color: #f59e0b;  /* picker hover outline color */
  --bl-si-transition-duration: 150ms;/* blur-in/out animation speed */
  --bl-si-redaction-color: #000000;  /* background color for redacted mode */
}
```

These are fallback defaults. `content_script.applySettingsToDom()` overwrites them with the user's actual settings via `document.documentElement.style.setProperty()`. The engine never reads or writes these properties — it only references them in CSS rule strings like `blur(var(--bl-si-radius, 10px))`.

**Propagation to shadow DOM:** CSS custom properties are inherited by default. Elements inside any shadow root inherit `--bl-si-radius` from `:root` without any extra propagation step. This is why gaussian-mode blur works inside web components without per-root variable injection.

### Gaussian Fallback Rules (for all three blur systems)

```css
/* Blur-all text-check elements (gaussian fallback — injected <style> handles other modes) */
[data-bl-si-blur]:not([data-bl-si-reveal]) {
  filter: blur(var(--bl-si-radius, 10px)) !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
  user-select: none !important;
}

/* Pick-blur items — gaussian baseline */
[data-bl-si-pick-blur]:not([data-bl-si-reveal]) {
  filter: blur(var(--bl-si-radius, 10px)) !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
  user-select: none !important;
}

/* PII auto-detect blur — independent of blur-all. Fixed 12px (not CSS var). */
[data-bl-si-pii]:not([data-bl-si-reveal]) {
  filter: blur(12px) !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
  user-select: none !important;
}
```

**Why three separate rules instead of one combined selector:**
Each system has different semantics. PII uses a fixed 12px (not the user's radius var). Combining them would prevent individual system customization.

**Why `content.css` has these rules at all:** When blur-all is *off* but the user has pick-blur items or PII detection active, there is no injected `<style>` (`#bl-si-blur-styles` doesn't exist). These static rules provide the gaussian fallback so individual items still blur correctly.

### Reveal Rules (static, blur-all OFF case)

```css
/* Primary reveal: clears filter on the stamped element */
[data-bl-si-reveal] {
  filter: none !important;
  visibility: visible !important;
  font-family: unset !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
  user-select: auto !important;
}

/* Cascade reveal: clears filter on blurred children of a revealed ancestor */
[data-bl-si-reveal] [data-bl-si-blur],
[data-bl-si-reveal] [data-bl-si-pii],
[data-bl-si-reveal] [data-bl-si-pick-blur] {
  filter: none !important;
  user-select: auto !important;
}

/* Pick-blur reveal — clears background-color for color mode */
[data-bl-si-pick-blur][data-bl-si-reveal] {
  filter: none !important;
  background-color: transparent !important;
  color: inherit !important;
  visibility: visible !important;
  font-family: unset !important;
  user-select: auto !important;
}

/* Zone overlay reveal */
.bl-si-zone-overlay[data-bl-si-reveal] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background: transparent !important;
  background-color: transparent !important;
}
```

**The critical rule about duplicate reveal declarations:** These exact same rules are *also* pushed inside `injectRules()` in `blur_engine.js`. Both copies are required:
- The `content.css` copy handles reveal when **blur-all is OFF** (no injected `<style>` exists).
- The injected copy handles reveal when **blur-all is ON**. When blur-all is ON, the injected `<style>` contains both blur rules and reveal rules in a single stylesheet. Since all rules use `!important`, CSS source order decides ties — the reveal rules must appear *after* the blur rules in the same `<style>` block to win. The static `content.css` reveal rule would lose this race against the injected blur-all rule (the injected stylesheet appears later in the cascade).

### Zone Overlay Base Styles

```css
.bl-si-zone-overlay {
  position: absolute !important;
  backdrop-filter: blur(var(--bl-si-radius, 10px)) !important;
  -webkit-backdrop-filter: blur(var(--bl-si-radius, 10px)) !important;
  background: rgba(128, 128, 128, 0.05) !important;
  border: 1px dashed rgba(128, 128, 128, 0.3) !important;
  z-index: 2147483640 !important;
  pointer-events: none !important;
  transition: opacity var(--bl-si-transition-duration, 150ms) !important;
}

/* Screen-anchored zones override the default position:absolute */
.bl-si-zone-overlay[data-bl-si-zone-anchor="screen"] {
  position: fixed !important;
}
```

Zone overlays use `backdrop-filter` (not `filter`) because they are semi-transparent divs *layered on top of* the page content — they blur what's visually behind them, not their own content. `filter: blur()` on an empty div would blur nothing.

**Note:** The engine also sets `position` inline via `el.style.cssText`. The CSS rule here is a backstop. For screen-anchored zones, the CSS attribute selector overrides to `fixed`.

When the picker is active, zone overlays become interactive:
```css
.bl-si-picker-active .bl-si-zone-overlay {
  pointer-events: auto !important;
  cursor: pointer !important;
  border-color: var(--bl-si-highlight-color, #f59e0b) !important;
}
```

---

## Layer 2: `<style id="bl-si-blur-styles">` (Injected, Blur-all ON)

Created by `injectRules(root, categories, mode)`. Lives in `root.head ?? root` (document `<head>` for the main document; injected directly into the shadow root for shadow DOM). Destroyed by `removeRules(root)`.

**Lifecycle:**
- Created: when `handleMainDocument(settings)` runs with `blur_all_active === true`
- Destroyed: when `handleMainDocument(settings)` runs with `blur_all_active === false`, or when `teardown(root)` runs

### The `EXCLUDE` `:not()` Chain

Every tag-based selector has a compound `:not()` suffix that prevents blur-all from matching elements owned by competing systems:

```js
const EXCLUDE =
  ":not(#bl-si-picker-toolbar):not(#bl-si-picker-toolbar *)" +
  ":not(.bl-si-toast):not(.bl-si-toast *)" +
  ":not(.bl-si-toolbar):not(.bl-si-toolbar *)" +
  ":not(#" + SVG_FILTER_ID + ")" +
  ":not([data-bl-si-reveal])" +
  ":not([data-bl-si-pick-blur])" +
  ":not([data-bl-si-pii])";
```

Applied to every always-blur tag:
```js
const excluded = alwaysBlurSelector
  .split(",")
  .map(t => t.trim() + EXCLUDE)
  .join(",");
rules.push(`${excluded} { ${blurDecl} }`);
```

Example generated rule for a blur mode like gaussian:
```css
h1:not(#bl-si-picker-toolbar):not(#bl-si-picker-toolbar *):not(.bl-si-toast)...:not([data-bl-si-pick-blur]):not([data-bl-si-pii]) { filter: blur(var(--bl-si-radius, 10px)) !important; ... }
```

**Why the EXCLUDE chain is critical:**
CSS tag selectors like `p:not(...)` have specificity `(0,7,1)` for a chain of 7 `:not()` pseudo-classes with one tag — this beats the attribute selector `[data-bl-si-pick-blur]` which has specificity `(0,1,0)`. Without the `:not([data-bl-si-pick-blur])` exclusion, blur-all's tag rule would win over pick-blur's attribute rule, visually re-blurring picker items in the wrong mode (e.g., applying gaussian blur to a color-mode picker item).

**What must stay in EXCLUDE:**
- All competing blur attributes (`pick-blur`, `pii`)
- All extension UI selectors (toolbar, toast, SVG filter)
- `[data-bl-si-reveal]` — elements being temporarily revealed must not be matched by blur-all

**If adding a new competing blur system**, add its attribute to `EXCLUDE`. Otherwise the tag selector specificity will override the new system's attribute rule.

### Mode-specific CSS Declarations

The `blurDecl` string changes based on `mode`:

**Gaussian (default):**
```css
filter: blur(var(--bl-si-radius, 10px)) !important;
transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
user-select: none !important;
```
References CSS var — live radius changes require no DOM work.

**Frosted:**
```css
filter: url(#bl-si-frosted-filter) !important;
transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
user-select: none !important;
```
References the SVG filter injected by `ensureSvgFilter()`.

**Redacted:**
```css
background-color: var(--bl-si-redaction-color, #000) !important;
color: transparent !important;
border-color: var(--bl-si-redaction-color, #000) !important;
text-decoration-color: transparent !important;
filter: none !important;
user-select: none !important;
```
`filter: none !important` cancels the static `content.css` gaussian rule for `[data-bl-si-blur]` elements, so only the background-color shows.

**Censored:**
```css
font-family: "bl-si-censored-disc" !important;
filter: none !important;
user-select: none !important;
```
Font replacement: every glyph renders as a filled disc (●). `filter: none` cancels the gaussian fallback.

### Font Injection (Censored Mode)

When mode is censored, the `@font-face` declaration for `"bl-si-censored-disc"` is prepended to the rules array *in the same `<style>` block*:

```js
if (isMasked && blsi.Fonts) rules.push(blsi.Fonts.DISC_FONT_FACE);
```

The font face rule is a base64-encoded WOFF2 data URL (~784 bytes):
```css
@font-face {
  font-family: "bl-si-censored-disc";
  src: url("data:font/woff2;base64,...") format("woff2");
  font-display: block;
}
```

Placing the `@font-face` and the usage rule in the same `<style>` element ensures they are parsed together and the font is available immediately when the rule is evaluated.

### Media Elements in Redacted/Censored Modes

Images, videos, canvas, SVG, audio, and picture elements cannot be hidden via `color: transparent`. They get extra rules:

**Redacted mode — media:**
```css
img[data-bl-si-blur]:not([data-bl-si-reveal]),
video[data-bl-si-blur]:not([data-bl-si-reveal]),
... {
  visibility: hidden !important;
  user-select: none !important;
}
```
`visibility: hidden` hides the image pixels while the element's box still occupies space, showing the `background-color` from `blurDecl`.

**Censored mode — media:**
```css
img[data-bl-si-blur]:not([data-bl-si-reveal]),
... {
  filter: brightness(0) !important;
  user-select: none !important;
}
```
`brightness(0)` renders the image as solid black, overriding any existing `filter`.

These rules apply to both always-blur (via tag selector with EXCLUDE) and stamped (via `[data-bl-si-blur]` attribute) media elements.

### Reveal Overrides (Injected Copy)

The injected `<style>` ends with reveal rules that mirror the static `content.css` declarations:

```css
[data-bl-si-reveal] { filter: none !important; visibility: visible !important; font-family: unset !important; ... }
[data-bl-si-reveal] [data-bl-si-blur] { filter: none !important; user-select: auto !important; }
[data-bl-si-reveal] [data-bl-si-pick-blur] { filter: none !important; background-color: transparent !important; color: inherit !important; font-family: unset !important; user-select: auto !important; }
[data-bl-si-reveal] [data-bl-si-pii] { filter: none !important; user-select: auto !important; }
```

**Source-order victory:** These reveal rules are pushed *after* the blur rules in the same array:
```js
const rules = [];
// ... blur rules ...
rules.push(`[data-bl-si-reveal] { ... }`);  // comes after blur rules
// ...
styleEl.textContent = rules.join("\n");
```

When `!important` is equal on two rules in the same stylesheet, source order decides. The reveal rules appearing later in the `<style>` block win over the blur rules appearing earlier — this is the mechanism that makes `filter: none !important` beat `filter: blur(...) !important`.

---

## Layer 3: `<style id="bl-si-pick-blur-styles">` (Injected, Non-Gaussian Pick Modes Only)

Created by `injectPickBlurRules(root, type, color)`. Only exists when pick-blur mode is `frosted` or `color` — for gaussian mode, the static `content.css` rule already handles `[data-bl-si-pick-blur]`.

```js
function injectPickBlurRules(root, type, color) {
  removePickBlurRules(root);
  // blur: static content.css already handles gaussian
  if (!type || type === blsi.pick_blur_modes.blur) return;
  // ... build rules for frosted or color ...
}
```

**Frosted pick-blur:**
```css
[data-bl-si-pick-blur]:not([data-bl-si-reveal]) {
  filter: url(#bl-si-frosted-filter) !important;
  transition: filter ... !important;
  user-select: none !important;
}
[data-bl-si-pick-blur][data-bl-si-reveal] { filter: none !important; }
```
Also calls `ensureSvgFilter(root)` to inject the SVG filter.

**Color pick-blur (two separate rules):**

```css
/* Regular elements: hide content with background color */
[data-bl-si-pick-blur]:not(.bl-si-zone-overlay):not([data-bl-si-reveal]) {
  background-color: rgba(r,g,b,a) !important;
  color: transparent !important;
  filter: none !important;
  user-select: none !important;
}

/* Zone overlays: replace backdrop-filter with flat background */
.bl-si-zone-overlay[data-bl-si-pick-blur]:not([data-bl-si-reveal]) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background: rgba(r,g,b,a) !important;
  border: none !important;
}

/* Reveal */
[data-bl-si-pick-blur][data-bl-si-reveal] {
  background-color: transparent !important;
  color: inherit !important;
  filter: none !important;
  user-select: auto !important;
}
```

Why zone overlays need a separate rule: zone overlays are visually-styled divs that use `backdrop-filter` for their blur effect. Setting `background-color` on them would not replace the backdrop-filter — both would apply simultaneously. The separate rule disables `backdrop-filter` and substitutes a flat `background` color.

**Injection target:** `(root.head ?? root)` — same shadow-root-aware injection as `injectRules`.

---

## Layer 4: `<style id="bl-si-pii-styles">` (Injected, PII Detection Active)

Created by `injectPiiRules(mode, color)`. Managed independently of blur-all — exists whenever PII detection is enabled, regardless of blur-all state.

```js
const PII_STYLE_ID = "bl-si-pii-styles";

function injectPiiRules(mode, color) {
  removePiiRules();
  if (!document.head) return;

  const piiSel = `[data-bl-si-pii]:not([data-bl-si-reveal])`;
  // ... build blurDecl based on mode ...
  // ... push rules including @font-face for starred mode ...
  document.head.appendChild(styleEl);
}
```

**PII uses fixed 12px, not CSS var:**
```css
/* When mode is default blur: */
[data-bl-si-pii]:not([data-bl-si-reveal]) {
  filter: blur(12px) !important;
  ...
}
```

The `content.css` static rule also uses `12px`. PII detection is an automated scan — the 12px default is intentionally fixed for predictable automatic blurring. The user's `--bl-si-radius` setting is for manually-applied blurs.

**Redacted PII:**
```css
[data-bl-si-pii]:not([data-bl-si-reveal]) {
  background-color: #FF0000 !important; /* or var(--bl-si-redaction-color) */
  color: transparent !important;
  border-color: #FF0000 !important;
  text-decoration-color: transparent !important;
  filter: none !important;
  user-select: none !important;
}
```

**Starred PII (font replacement + @font-face):**
```css
@font-face {
  font-family: "bl-si-starred-asterisk";
  src: url("data:font/woff2;base64,...") format("woff2");
  font-display: block;
}
[data-bl-si-pii]:not([data-bl-si-reveal]) {
  font-family: "bl-si-starred-asterisk" !important;
  filter: none !important;
  user-select: none !important;
}
```

**PII reveal override:**
```css
[data-bl-si-reveal] [data-bl-si-pii] {
  filter: none !important;
  font-family: unset !important;
  color: unset !important;
  background-color: unset !important;
  user-select: auto !important;
}
```

**Why `document.head` not shadow root:** PII spans are injected by `pii_detector.js` into the main document's text nodes. The PII CSS is only injected into `document.head`. Shadow roots do not get PII CSS (PII detection is not shadow-root-aware in the current implementation).

---

## CSS Specificity Arithmetic

Understanding specificity prevents accidental rule ordering bugs.

| Rule | Example | Specificity | Wins over |
|---|---|---|---|
| Always-blur tag + EXCLUDE chain | `h1:not(#x):not(#x *):not(...)...` | `(0,7,1)` with 7 `:not()` pseudo-classes | attribute selectors |
| Attribute selector | `[data-bl-si-blur]` | `(0,1,0)` | tag-only selectors |
| Class selector | `.bl-si-zone-overlay` | `(0,1,0)` | tag-only selectors |
| Class + attribute | `.bl-si-zone-overlay[data-bl-si-reveal]` | `(0,2,0)` | single attribute or class |

**Key invariant:** Tag selectors with EXCLUDE beat attribute selectors at equal `!important`. This is why `EXCLUDE` must contain `:not([data-bl-si-pick-blur])` — without it, `p:not(...)` would match and blur a `<p>` that's also carrying `data-bl-si-pick-blur`, applying the wrong blur mode.

**Source-order as the final tiebreaker:** When two `!important` rules have the same specificity, the one that appears *later* in the stylesheet (or in a later stylesheet) wins. This is the core mechanism used for:
1. Reveal rules winning over blur rules (reveal pushed after blur in same `<style>` block)
2. The `content.css` static reveal handling the blur-all OFF case
3. The injected reveal rules winning in the blur-all ON case

---

## CSS Custom Properties: Who Sets, Who Reads

| Property | Set by | Read by | Propagation |
|---|---|---|---|
| `--bl-si-radius` | `content_script.applySettingsToDom()` | Gaussian/frosted CSS rules, `_readCssRadius()` | Inherits into shadow DOM automatically |
| `--bl-si-highlight-color` | `content_script.applySettingsToDom()` | Picker hover highlight CSS, toolbar CSS | Inherits into shadow DOM |
| `--bl-si-transition-duration` | `content_script.applySettingsToDom()` | Blur/reveal transition CSS | Inherits into shadow DOM |
| `--bl-si-redaction-color` | `content_script.applySettingsToDom()` | Redacted mode blur CSS, PII redacted CSS | Inherits into shadow DOM |

**The engine does not set these properties.** It only references them in CSS rule strings. This design ensures:
1. Content script owns the authoritative source of CSS var values
2. Engine can be tested with inline `settings` objects without needing a real DOM
3. Changing blur radius in gaussian mode requires exactly zero DOM manipulation in the engine
