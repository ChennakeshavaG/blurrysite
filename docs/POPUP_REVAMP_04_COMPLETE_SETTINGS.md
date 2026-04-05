# Popup Revamp — Part 4: Complete Settings Reference

Every configurable option in the system, organized by section.

## Global Settings (`chrome.storage.local.settings`)

### Appearance

| Key | Type | Default | Range | UI control | Description |
|---|---|---|---|---|---|
| `BLUR_RADIUS` | number | 10 | 2-30 | Range slider | Blur intensity in pixels. Higher = more obscured. 10px defeats OCR; 20px+ defeats AI. |
| `TRANSITION_DURATION` | number | 200 | 0-2000 | Toggle (0 or 200) | Milliseconds for blur animation. 0 = instant. |
| `HIGHLIGHT_COLOR` | hex string | #f59e0b | Any valid hex | Color picker | Picker toolbar hover outline color. |
| `BLUR_MODE` | enum | GAUSSIAN | gaussian, frosted | Select/radio | Gaussian = standard CSS blur. Frosted = SVG displacement + blur (AI-resistant). |

### Behavior

| Key | Type | Default | Values | UI control | Description |
|---|---|---|---|---|---|
| `REVEAL_MODE` | enum | HOVER | none, click, hover | Select | How to temporarily unblur content. Hover = mouse over. Click = click to peek, Escape to dismiss. None = no reveal. |
| `ENABLED` | boolean | true | true/false | Toggle | Master on/off for the entire extension. |
| `THOROUGH_BLUR` | boolean | false | true/false | Toggle | When ON, blurs ALL matched elements even without direct text content. Catches framework-rendered containers. More aggressive, may blur empty layout wrappers. |

### Blur Categories

| Key | Type | Default | UI control | What it covers |
|---|---|---|---|---|
| `BLUR_CATEGORIES.TEXT` | boolean | true | Toggle | 42 elements: h1-h6, p, blockquote, pre, figcaption, summary + 31 inline (span, a, em, strong, code, etc.) |
| `BLUR_CATEGORIES.MEDIA` | boolean | true | Toggle | 3 elements: img (CSS blur), video (canvas overlay), canvas (CSS blur) |
| `BLUR_CATEGORIES.FORM` | boolean | false | Toggle | 7 elements: input, textarea, select (always-blur) + button, output, fieldset, legend (text-check) |
| `BLUR_CATEGORIES.TABLE` | boolean | true | Toggle | 3 elements: caption (always-blur) + td, th (text-check) |
| `BLUR_CATEGORIES.STRUCTURE` | boolean | true | Toggle | 9 elements: div, section, article, aside, header, footer, figure, details, dialog (all text-check) |

### Keyboard Shortcuts

| Key | Type | Default | UI control | Action |
|---|---|---|---|---|
| `SHORTCUTS.TOGGLE_BLUR_ALL` | { primaryModifier, keys[] } | AltLeft + ShiftLeft + KeyB | Capture modal | Blur/unblur all page content |
| `SHORTCUTS.TOGGLE_PICKER` | { primaryModifier, keys[] } | AltLeft + ShiftLeft + KeyP | Capture modal | Activate/deactivate element picker |
| `SHORTCUTS.CLEAR_ALL` | { primaryModifier, keys[] } | AltLeft + ShiftLeft + KeyU | Capture modal | Clear all blur on current page |

### Performance

| Key | Type | Default | Range | UI control | Description |
|---|---|---|---|---|---|
| `PERFORMANCE.OFFSCREEN_UNBLUR` | boolean | true | true/false | Toggle | Remove blur from off-screen elements to free GPU layers. Re-blur when scrolled back (200px pre-buffer). Essential for infinite-scroll pages. |
| `PERFORMANCE.MAX_BLURRED` | number | 500 | 0-5000 | Number input | Maximum simultaneously blurred elements. 0 = unlimited. Prevents GPU memory exhaustion. Observer stops blurring past this limit. |
| `PERFORMANCE.CHUNK_SIZE` | number | 50 | 10-200 | Number input | MutationObserver batch size per animation frame. Lower = more responsive during heavy DOM churn. Higher = fewer callbacks. |

---

## URL Rules (`chrome.storage.local.rules`)

Array of per-URL setting overrides. First matching rule wins.

### Rule shape

```js
{
  id:          string,        // unique ID (r_xxxxxxxx)
  name:        string,        // user-defined label (max 100 chars)
  pattern:     string,        // URL pattern (max 500 chars)
  patternType: 'wildcard' | 'regex',
  settings:    {              // partial overrides — merged over global
    BLUR_RADIUS:      number,     // optional
    THOROUGH_BLUR:    boolean,    // optional
    BLUR_MODE:        string,     // optional (future)
    BLUR_CATEGORIES:  { ... },    // optional partial
    REVEAL_MODE:      string,     // optional (future)
  }
}
```

### Pattern matching

| Type | Syntax | Example | Matching behavior |
|---|---|---|---|
| Wildcard | `*` = any chars | `cliq.zoho.in/*` | Domain-boundary aware. `example.com` matches `sub.example.com`. Auto-prepends `*` if no protocol. |
| Regex | Raw regex string | `https://portal\.health\..*` | Matched case-insensitively against URL (without hash). Nested quantifiers rejected for ReDoS safety. Max 500 chars. |

### Currently overridable in rule editor

| Override | UI control | Notes |
|---|---|---|
| Form blur | Toggle | Only FORM category |
| Thorough blur | Toggle | |
| Blur radius | Slider 2-20 | Should extend to 30 |

### Should be overridable (future)

| Override | Why |
|---|---|
| All 5 category toggles | Different sites need different categories (banking = form ON, docs = form OFF) |
| Blur mode | Frosted for banking, gaussian for casual browsing |
| Reveal mode | Click for presentations, hover for daily use |

---

## Blur-All State (`chrome.storage.local.blur_all_hosts`)

Per-hostname boolean map. Persists blur-all mode across page reloads.

```js
{
  "cliq.zoho.in": true,
  "github.com": true
}
```

Saved on TOGGLE_BLUR_ALL and CLEAR_ALL_BLUR. Restored during init.

---

## Blurred Selectors (`chrome.storage.local.blurred_selectors`)

Per-hostname array of CSS selectors for individually blurred elements.

```js
{
  "example.com": ["#sensitive-div", "[data-pb-id='a1b2c3d4']"],
  "mail.google.com": ["[data-pb-id='e5f6g7h8']"]
}
```

Max 500 selectors per hostname. Max 2000 chars per selector.

---

## Enum Constants (from constants.js)

### REVEAL_MODES

| Constant | Value | Description |
|---|---|---|
| `REVEAL_MODES.NONE` | `'none'` | No reveal — blur stays permanently |
| `REVEAL_MODES.CLICK` | `'click'` | Click to peek, click again or Escape to dismiss |
| `REVEAL_MODES.HOVER` | `'hover'` | Hover to peek, debounced mouseout (150ms) |

### BLUR_MODES

| Constant | Value | Description |
|---|---|---|
| `BLUR_MODES.GAUSSIAN` | `'gaussian'` | Standard CSS Gaussian blur. GPU-accelerated. |
| `BLUR_MODES.FROSTED` | `'frosted'` | SVG displacement + blur. CPU-bound. AI-resistant. |

### PATTERN_TYPES

| Constant | Value | Description |
|---|---|---|
| `PATTERN_TYPES.WILDCARD` | `'wildcard'` | `*` matches any sequence, domain-boundary aware |
| `PATTERN_TYPES.REGEX` | `'regex'` | Raw regex, case-insensitive, max 500 chars |

### CSS Classes (CSS object)

| Constant | Value | Used for |
|---|---|---|
| `CSS.BLURRED` | `'pb-blurred'` | Core blur class |
| `CSS.FROSTED` | `'pb-frosted'` | Frosted mode overlay class |
| `CSS.REVEALED` | `'pb-revealed'` | Click-reveal active state |
| `CSS.REVEAL_ON_HOVER` | `'pb-reveal-on-hover'` | Hover-reveal target |
| `CSS.ANCESTOR_REVEAL` | `'pb-ancestor-reveal'` | Ancestor chain unblur |
| `CSS.CANVAS_OVERLAY` | `'pb-canvas-overlay'` | Video canvas overlay |
| `CSS.TEXT_WRAPPER` | `'pb-text-node-wrapper'` | Text node wrapper span |
| `CSS.HOVER_HIGHLIGHT` | `'pb-hover-highlight'` | Picker hover outline |
| `CSS.PICKER_ACTIVE` | `'pb-picker-active'` | Picker mode active on html |
| `CSS.TOAST` | `'pb-toast'` | Toast notification |
| `CSS.TOOLBAR` | `'pb-toolbar'` | Picker toolbar |
