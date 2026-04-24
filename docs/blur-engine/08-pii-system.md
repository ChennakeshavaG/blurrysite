# Blur Engine — PII System

PII (Personally Identifiable Information) blur is a parallel blur subsystem that detects sensitive text patterns and visually masks them. It operates independently of blur-all: PII spans can be blurred even when blur-all is OFF, and they survive `teardown()` calls that clear blur-all stamps. This document covers the interface between `pii_detector.js` (which places PII spans) and `blur_engine.js` (which manages PII CSS), and the full PII lifecycle.

---

## Architecture: Two Separate Modules

PII detection and PII blur rendering are split across two modules:

| Module | Responsibility |
|---|---|
| `src/pii_detector.js` | Scans text nodes, wraps matches in `<span data-bl-si-pii>` elements |
| `src/blur_engine.js` (injectPiiRules) | Manages the CSS that visually blurs `[data-bl-si-pii]` spans |

The engine knows nothing about which text matched PII patterns. The detector knows nothing about how to visually blur the spans. They are linked only through the `[data-bl-si-pii]` attribute.

---

## The `[data-bl-si-pii]` Attribute

PII spans placed by `pii_detector.js` carry exactly one attribute for blur ownership:

```html
<span data-bl-si-pii="email">user@example.com</span>
<span data-bl-si-pii="numeric">4532 1234 5678 9012</span>
```

The attribute value indicates the PII type (`"email"` or `"numeric"`). The CSS rules match the attribute regardless of value:

```css
[data-bl-si-pii]:not([data-bl-si-reveal]) { ... }
```

PII spans do **not** carry `data-bl-si-blur`. They are exclusively PII-owned. The `stampElements` guard and `teardown` both explicitly skip PII-stamped elements:

```js
// In stampElements:
if (el.dataset.blSiBlur && !el.dataset.blSiPii) delete el.dataset.blSiBlur;  // skips PII

// In teardown:
if (el.dataset.blSiBlur && !el.dataset.blSiPii) { delete el.dataset.blSiBlur; }  // skips PII
```

This ensures that blur-all's stamp sweep never touches PII spans, and that disabling blur-all does not un-blur PII content.

---

## PII Lifecycle in Content Script

PII state is managed by `content_script.applyState()`:

```js
// When PII is enabled:
if (piiEnabled) {
  PiiDetector.scan(document.body, activeTypes);   // places [data-bl-si-pii] spans
  Engine.injectPiiRules(piiMode, redactionColor); // inject CSS for the mode
  PiiDetector.observeMutations(document.body);    // MO for dynamic content
}

// When PII is disabled:
if (!piiEnabled) {
  PiiDetector.stopObserving();
  PiiDetector.clear(document.body);               // removes all [data-bl-si-pii] spans
  Engine.removePiiRules();                         // removes #bl-si-pii-styles
}
```

`PiiDetector.scan()` must run before `PiiDetector.observeMutations()` because the MO reads `_activeTypes` set by `scan()`.

---

## `injectPiiRules(mode, color)` — PII CSS Injection

```js
function injectPiiRules(mode, color) {
  removePiiRules();          // idempotent remove-then-inject
  if (!document.head) return;

  const piiSel = `[data-bl-si-pii]:not([data-bl-si-reveal])`;
  const isRedacted   = mode === blsi.pii_modes.redacted;
  const isAsterisked = mode === blsi.pii_modes.starred;
  const isFrosted    = mode === blsi.pii_modes.frosted;

  if (isFrosted) ensureSvgFilter(document);

  let blurDecl;
  // ... (see below) ...

  const rules = [];
  if (isAsterisked && blsi.Fonts) rules.push(blsi.Fonts.ASTERISK_FONT_FACE);
  rules.push(`${piiSel} { ${blurDecl} }`);
  rules.push(`[data-bl-si-reveal] [data-bl-si-pii] { filter: none !important; font-family: unset !important; color: unset !important; background-color: unset !important; user-select: auto !important; }`);

  const styleEl = document.createElement("style");
  styleEl.id = PII_STYLE_ID;  // "bl-si-pii-styles"
  styleEl.textContent = rules.join("\n");
  document.head.appendChild(styleEl);
}
```

Injected into `document.head` only (not shadow roots). PII detection is not shadow-root-aware.

---

## PII Mode CSS Declarations

### Default Blur (gaussian, fixed 12px)

```js
blurDecl =
  `filter: blur(12px) !important; ` +
  `transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ` +
  `user-select: none !important;`;
```

**Why fixed 12px, not CSS var:** PII detection is automated — the user did not manually select these elements. The 12px default is a design decision for PII clarity. The user's `--bl-si-radius` slider controls manually-applied blur, not automatic PII. Keeping them separate prevents a user accidentally reducing PII blur visibility by setting a low radius for aesthetic reasons.

The static `content.css` also uses `blur(12px)` for the PII fallback:
```css
[data-bl-si-pii]:not([data-bl-si-reveal]) {
  filter: blur(12px) !important;
  ...
}
```

### Frosted PII

```js
if (isFrosted) ensureSvgFilter(document);
const filterValue = isFrosted ? `url(#bl-si-frosted-filter)` : `blur(12px)`;
blurDecl =
  `filter: ${filterValue} !important; ` +
  `transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ` +
  `user-select: none !important;`;
```

Calls `ensureSvgFilter(document)` to ensure the SVG filter exists before the CSS rule references it. The SVG filter ID `"bl-si-frosted-filter"` is the same as used for frosted blur-all mode — the filter is shared.

**Potential conflict:** If blur-all is in frosted mode AND PII is in frosted mode simultaneously, both call `ensureSvgFilter(document)`. Since `ensureSvgFilter` always rebuilds (removes old + creates new), the second call produces a fresh filter, which is identical in structure. This is harmless but slightly redundant.

### Redacted PII

```js
const c = (color && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : 'var(--bl-si-redaction-color, #000)';
blurDecl =
  `background-color: ${c} !important; ` +
  `color: transparent !important; ` +
  `border-color: ${c} !important; ` +
  `text-decoration-color: transparent !important; ` +
  `filter: none !important; ` +
  `user-select: none !important;`;
```

The `color` argument is validated against `/^#[0-9a-fA-F]{6}$/` before use. Invalid or missing colors fall back to the CSS var. This prevents injection of arbitrary CSS values from storage.

**Color argument vs CSS var:** For PII redacted mode, the color is passed directly from `content_script` (which reads `settings.redaction_color`) and baked into the CSS rule string. This differs from blur-all redacted mode which uses the CSS var. Both approach the same value — the difference is timing: baked string = one-time evaluation at inject time; CSS var = live update at paint time. For PII, baking is fine because mode changes (which trigger re-injection) happen rarely.

### Starred PII (Font Replacement)

```js
blurDecl =
  `font-family: "bl-si-starred-asterisk" !important; ` +
  `filter: none !important; ` +
  `user-select: none !important;`;
```

The `@font-face` declaration is prepended:
```js
if (isAsterisked && blsi.Fonts) rules.push(blsi.Fonts.ASTERISK_FONT_FACE);
```

`blsi.Fonts.ASTERISK_FONT_FACE` is a 372-byte WOFF2 base64 data URL that maps every BMP codepoint to a 6-arm asterisk glyph. Placed in the same `<style>` block as the usage rule for synchronous parsing.

---

## `removePiiRules()` — Idempotent CSS Removal

```js
const PII_STYLE_ID = "bl-si-pii-styles";

function removePiiRules() {
  const el = document.head && document.head.querySelector('#' + PII_STYLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
```

Safe to call when no PII style exists. Called by:
- `injectPiiRules()` itself (remove-then-inject pattern for mode changes)
- `content_script.applyState()` when PII is disabled

---

## PII vs Blur-All CSS Interaction

When blur-all is ON and PII is ON simultaneously, two `<style>` elements exist:
- `#bl-si-blur-styles` — covers `[data-bl-si-blur]` and tag selectors (excludes `[data-bl-si-pii]` via EXCLUDE)
- `#bl-si-pii-styles` — covers `[data-bl-si-pii]`

The `EXCLUDE` chain in `injectRules` explicitly excludes PII elements:
```js
const EXCLUDE = "..." + ":not([data-bl-si-pii])";
```

This prevents blur-all's tag selectors (e.g., `span:not(...)`) from matching `<span data-bl-si-pii>` elements. Without this exclusion, a PII `<span>` in starred mode would also be matched by the blur-all tag rule, applying an additional gaussian `filter: blur()` on top of `filter: none` (from starred mode's rule) — canceling the font replacement with a blur.

---

## PII Reveal Integration

Both the static `content.css` and the injected `#bl-si-pii-styles` include reveal cascade rules:

```css
/* In content.css (static, covers blur-all OFF case): */
[data-bl-si-reveal] [data-bl-si-pii] {
  filter: none !important;
  user-select: auto !important;
}

/* In #bl-si-pii-styles (injected, handles starred/redacted mode): */
[data-bl-si-reveal] [data-bl-si-pii] {
  filter: none !important;
  font-family: unset !important;     /* removes starred font */
  color: unset !important;           /* restores text color for redacted mode */
  background-color: unset !important;/* restores background for redacted mode */
  user-select: auto !important;
}
```

`reveal_controller.js` recognizes PII elements via `Engine.isVisuallyBlurred()`:
```js
function isVisuallyBlurred(element) {
  if (element.dataset.blSiPii) return true;  // PII spans are always visually blurred
  // ...
}
```

This allows hover/click reveal to reveal PII spans. The ancestor chain walk also stamps `[data-bl-si-reveal]` on blurred ancestors of PII spans, clearing any parent filter that would override the child's `filter: none`.

---

## `pii_detector.js` Interface Points

The engine never calls `pii_detector.js` directly. `content_script.js` orchestrates both:

```js
// Enable PII:
PiiDetector.scan(document.body, { email: true, numeric: false });
// → places <span data-bl-si-pii="email">...</span> spans
Engine.injectPiiRules('blur', null);
// → injects CSS that blurs [data-bl-si-pii]
PiiDetector.observeMutations(document.body);
// → MO catches new PII text added dynamically

// Disable PII:
PiiDetector.stopObserving();
PiiDetector.clear(document.body);
// → removes all [data-bl-si-pii] spans, restores text nodes
Engine.removePiiRules();
// → removes #bl-si-pii-styles
```

`PiiDetector.clear()` is the inverse of `scan()` — it removes spans and joins text nodes back. After `clear()`, the engine's `removePiiRules()` removes the CSS. The order matters: removing CSS first would cause a flash of un-blurred text during the `clear()` DOM manipulation; removing spans first ensures the visual update is atomic (spans go away, CSS removed immediately after).

---

## Why PII Survives `teardown()`

```js
// In teardown():
root.querySelectorAll('*').forEach(el => {
  if (el.dataset.blSiBlur && !el.dataset.blSiPii) {  // ← explicit PII skip
    delete el.dataset.blSiBlur;
  }
  // ...
});
```

PII has an independent lifecycle managed by `content_script.applyState()`. When blur-all turns off:
- `teardown(document)` clears `data-bl-si-blur` and CSS from blur-all
- PII's `data-bl-si-pii` spans remain
- `#bl-si-pii-styles` remains (not touched by `teardown`)

The user sees: blur-all blur disappears, PII blurs persist. This is correct behavior — automated PII detection should remain active regardless of the user's manual blur-all toggle.

---

## PII CSS Specificity Notes

| Rule | Specificity |
|---|---|
| `[data-bl-si-pii]:not([data-bl-si-reveal])` | `(0,2,0)` — one attribute + one pseudo-class |
| `[data-bl-si-reveal] [data-bl-si-pii]` | `(0,2,0)` — two attribute selectors |
| Blur-all tag rule `span:not(...)` | `(0,7,1)` — tag + 7 pseudo-classes |

PII attribute selector and the blur-all tag selector can both match a `<span data-bl-si-pii>` if EXCLUDE is not present. EXCLUDE's `:not([data-bl-si-pii])` raises the blur-all tag selector's specificity from `(0,7,1)` to even higher — but the important point is that `<span>` with PII is explicitly excluded, so the tag rule never fires.

The reveal cascade rule `[data-bl-si-reveal] [data-bl-si-pii]` has the same specificity as the base PII rule `[data-bl-si-pii]` — source order decides. The reveal rule is pushed *after* the blur rule in the same `<style>` block, so it wins.
