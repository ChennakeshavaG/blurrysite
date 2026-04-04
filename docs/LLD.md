# PrivacyBlur — Low-Level Design

## 1. Module Contracts

Each source module is an IIFE that assigns exactly one global on `window`. Modules have no direct imports or exports — they communicate only through their public API. The load order defined in `manifest.json` ensures dependencies are available when a module initialises.

**Load order:**
```
selector_utils.js  → window.PrivacyBlurSelectorUtils
storage_manager.js → window.PrivacyBlurStorage
blur_engine.js     → window.PrivacyBlurEngine
shortcut_handler.js→ window.PrivacyBlurShortcuts
picker.js          → window.PrivacyBlurPicker
content_script.js  → (orchestrator, no global)
```

---

## 2. blur_engine.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `videoOverlayMap` | `WeakMap<Element, {canvas, animFrameId}>` | Tracks canvas overlays and RAF handles for video elements |
| `CATEGORY_SELECTORS` | `Record<string, string>` | Maps each category name to its CSS selector string (constant) |
| `selectorCache` | `{ key: string, combined: string } \| null` | Cached combined selector string; invalidated when active categories change |

### Public API

```typescript
type BlurCategories = {
  text: boolean;
  media: boolean;
  form: boolean;
  table: boolean;
  structure: boolean;
};

interface PrivacyBlurEngine {
  applyBlur(element: Element, radius?: number): void;
  removeBlur(element: Element): void;
  toggleBlur(element: Element, radius?: number): void;
  blurAllContent(radius?: number, options?: { categories?: BlurCategories }): void;
  unblurAll(): void;
  isBlurred(element: Element): boolean;
  invalidateSelectorCache(): void;
  matchesActiveCategories(element: Element, categories?: BlurCategories): boolean;
}
```

### applyBlur — element dispatch

```
applyBlur(el, radius = 8)
  if el is null or not Element → return
  if isBlurred(el) → return (idempotent)
  
  tag = el.tagName.toLowerCase()
  
  if tag === "video":
    el.classList.add(BLURRED_CLASS)
    el.style.setProperty("--pb-radius", radius + "px")
    startVideoBlurCanvas(el, radius)
    
  elif tag === "img":
    el.classList.add(BLURRED_CLASS)
    el.style.setProperty("--pb-radius", radius + "px")
    el.style.filter = "blur(" + radius + "px)"
    
  elif backgroundImage !== "none":
    el.classList.add(BLURRED_CLASS)
    el.style.setProperty("--pb-radius", radius + "px")
    
  else:
    wrapTextNodes(el)  // wrap bare text nodes in <span>
    el.classList.add(BLURRED_CLASS)
    el.style.setProperty("--pb-radius", radius + "px")
```

### Video canvas overlay

```
startVideoBlurCanvas(videoElement, radius)
  stop any existing overlay (stopVideoBlurCanvas)
  canvas = createElement("canvas")
  canvas.className = "pb-canvas-overlay"
  size canvas from videoElement.videoWidth/Height or getBoundingClientRect
  position canvas absolutely over video (CSS: position absolute, z-index 9999)
  if parent is position:static → set parent to position:relative
  insert canvas after videoElement
  ctx = canvas.getContext("2d")
  
  function drawFrame():
    ctx.clearRect(...)
    ctx.filter = "blur(" + radius + "px)"
    try:
      ctx.drawImage(videoElement, 0, 0, w, h)
    catch:
      // DRM video — fill with dark overlay instead
      ctx.fillStyle = "rgba(30,30,30,0.85)"
      ctx.fillRect(0, 0, w, h)
    animFrameId = requestAnimationFrame(drawFrame)
  
  drawFrame()
  videoOverlayMap.set(videoElement, { canvas, animFrameId })
```

### blurAllContent — target selectors

Queries and blurs all of:
```
img, video, canvas, h1, h2, h3, h4, h5, h6, p, span, [class*="text"]
```
Then separately iterates `div, section, article, li, td, th, label, button, a` and blurs only those with meaningful direct text-node children.

### CSS class constants

| Constant | Value |
|---|---|
| `BLURRED_CLASS` | `"pb-blurred"` |
| `CANVAS_CLASS` | `"pb-canvas-overlay"` |
| `TEXT_WRAPPER_CLASS` | `"pb-text-node-wrapper"` |
| `WRAPPER_CLASS` | `"pb-img-wrapper"` |

---

## 3. selector_utils.js

### Public API

```typescript
interface PrivacyBlurSelectorUtils {
  getSelector(element: Element | null): string | null;
  generateId(): string;
  restoreSelector(selector: string | null): Element | null;
  restoreAllSelectors(selectors: string[]): Element[];
}
```

### getSelector — strategy

```
getSelector(element)
  if null, body, or documentElement → return null

  // Strategy 1: unique id
  id = element.getAttribute("id")
  if id is non-empty:
    idSelector = "#" + CSS.escape(id)
    if document.querySelectorAll(idSelector).length === 1 → return idSelector

  // Strategy 2: stamp data-pb-id
  if element.dataset.pbId is empty:
    element.dataset.pbId = generateId()   // 8-char hex UUID
  return '[data-pb-id="' + element.dataset.pbId + '"]'
```

### generateId

Uses `crypto.getRandomValues(Uint32Array)` when available; falls back to `Math.random()`. Returns an 8-character lowercase hex string.

### restoreSelector

Wraps `document.querySelector(selector)` in a try-catch. Returns `null` for invalid selector syntax or no match.

### cssEscape

Calls `CSS.escape()` when available; falls back to a regex that backslash-escapes all non-word, non-hyphen characters.

---

## 4. storage_manager.js

### Constants

```javascript
DEFAULT_SETTINGS = {
  blurRadius: 8,
  highlightColor: "#f59e0b",
  transitionDuration: 200,
  revealOnHover: false,
  enabled: true,
  shortcuts: {
    chordKey1: "k",
    chordKey2: "v",
    chordModifier: "ctrl"
  },
  blurCategories: {
    text: true,
    media: true,
    form: false,
    table: true,
    structure: true
  }
}
```

### Public API

```typescript
interface PrivacyBlurStorage {
  saveBlurredElement(hostname: string, selector: string): Promise<any>;
  removeBlurredElement(hostname: string, selector: string): Promise<void>;
  getBlurredSelectors(hostname: string): Promise<string[]>;
  clearHost(hostname: string): Promise<void>;
  clearAll(): Promise<void>;
  getSettings(): Promise<object>;
  saveSettings(partial: object): Promise<void>;
  DEFAULT_SETTINGS: object;
}
```

### send() — Promise wrapper

```
send(message)
  return new Promise((resolve, reject) => {
    try:
      chrome.runtime.sendMessage(message, (response) => {
        if chrome.runtime.lastError → reject(error)
        else → resolve(response)
      })
    catch e → reject(e)
  })
```

### saveSettings — fetch-merge-save

```
saveSettings(partial)
  if partial is null or not object → return
  current = await getSettings()   // fetches from background, merged with defaults
  merged = Object.assign({}, current, partial)
  await send({ type: "SAVE_SETTINGS", settings: merged })
```

### getSettings — merge with defaults

```
getSettings()
  response = await send({ type: "GET_SETTINGS" })
  stored = response.settings || {}
  return Object.assign({}, DEFAULT_SETTINGS, stored)
```

---

## 5. shortcut_handler.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `activeListener` | `Function \| null` | Reference to the installed keydown handler |
| `awaitingChordSecond` | `boolean` | True after first chord key detected |
| `lastChordKeyTime` | `number` | `Date.now()` when first chord key was pressed |
| `chordTimeoutId` | `number \| null` | Timeout that resets chord state after 1000 ms |
| `currentToastEl` | `Element \| null` | Currently displayed toast element |
| `_isPickerActive` | `boolean` | Set by content_script when picker opens/closes |

### Public API

```typescript
interface PrivacyBlurShortcuts {
  init(settings: ShortcutSettings, callbacks: ShortcutCallbacks): void;
  destroy(): void;
  showToast(text: string, duration?: number): void;
  _setPickerActive(active: boolean): void;
}

interface ShortcutSettings {
  chordKey?: string;       // default "k"
  chordSecond?: string;    // default "v"
  chordModifier?: string;  // "ctrl" | "alt" | "shift" | "meta", default "ctrl"
}

interface ShortcutCallbacks {
  TOGGLE_BLUR_ALL?: () => void;
  onExitPicker?: () => void;
  onChordStart?: () => void;  // optional, fires on first chord key
}
```

### init — chord detection logic

```
init(settings, callbacks)
  destroy()  // detach any existing listener

  chordKey1 = settings.chordKey || "k"
  chordKey2 = settings.chordSecond || "v"
  modifier  = settings.chordModifier || "ctrl"

  onKeyDown(event):
    key = event.key.toLowerCase()

    if key === "escape":
      resetChordState()
      if _isPickerActive:
        _isPickerActive = false
        callbacks.onExitPicker?.()
      return

    if !awaitingChordSecond AND modifierActive(event, modifier) AND key === chordKey1:
      event.preventDefault()
      awaitingChordSecond = true
      lastChordKeyTime = Date.now()
      callbacks.onChordStart?.()
      chordTimeoutId = setTimeout(resetChordState, 1000)
      return

    if awaitingChordSecond:
      elapsed = Date.now() - lastChordKeyTime
      if elapsed <= 1000 AND key === chordKey2 AND !anyModifier(event):
        resetChordState()
        callbacks.TOGGLE_BLUR_ALL?.()
        showToast("PrivacyBlur: Blur All triggered")
      else:
        resetChordState()  // wrong key or timeout
      return

  document.addEventListener("keydown", onKeyDown, true)  // capture phase
  activeListener = onKeyDown
```

### modifierActive — strict modifier check

Returns true only when the named modifier is held AND no other modifiers are held. This prevents e.g. `Ctrl+Alt+K` from being treated as the chord start.

### showToast

Creates a fixed-position `<div>` at top-right (z-index: 2147483647), appends to body, fades out after `duration` ms with a 200ms CSS transition, then removes from DOM.

---

## 6. picker.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `isActive` | `boolean` | Whether picker is active |
| `hoveredElement` | `Element \| null` | Currently highlighted element |
| `selectedElements` | `Set<Element>` | Elements blurred in this picker session |
| `activeSettings` | `object` | Settings snapshot used for blur radius |
| `activeCallbacks` | `object` | Callbacks from content_script |
| `toolbarEl` | `Element \| null` | Injected toolbar element |

### Public API

```typescript
interface PrivacyBlurPicker {
  readonly isActive: boolean;
  activate(settings: object, callbacks: PickerCallbacks): void;
  deactivate(): void;
  setSettings(newSettings: object): void;
}

interface PickerCallbacks {
  onBlur?: (element: Element) => void;
  onUnblur?: (element: Element) => void;
  onDeactivate?: () => void;
}
```

### activate — event wiring

All listeners registered at capture phase (`true`) so picker intercepts before page scripts.

```
activate(settings, callbacks)
  if isActive → return (idempotent)
  
  isActive = true
  merge settings into activeSettings
  activeCallbacks = callbacks
  
  document.documentElement.classList.add("pb-picker-active")
  buildToolbar()  // creates #pb-picker-toolbar, appends to document.body
  
  document.addEventListener("mouseover", onMouseOver, true)
  document.addEventListener("mouseout",  onMouseOut,  true)
  document.addEventListener("click",     onClick,     true)
  document.addEventListener("keydown",   onKeyDown,   true)
```

### onClick — blur/unblur dispatch

```
onClick(event)
  target = resolveTarget(event.target)
  if !target or target is toolbar → return

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()

  if target.classList.contains("pb-blurred"):
    callbacks.onUnblur?.(target)
    selectedElements.delete(target)
    flashElementIndicator(target, "Unblurred")
  else:
    callbacks.onBlur?.(target)
    selectedElements.add(target)
    flashElementIndicator(target, "Blurred")
```

### resolveTarget

Returns null for `document.documentElement`, `document.body`, and non-Element event targets. Prevents accidentally blurring the entire page body.

### buildToolbar

Creates a `<div id="pb-picker-toolbar">` with:
- Left: status label text
- Right: "Clear all" button + "×" close button
- Appended to `document.body`
- Captures `mouseover`, `mouseout`, `click` on itself to prevent picker events propagating into it

---

## 7. content_script.js

### Initialisation sequence

```
if DOM not ready → wait for DOMContentLoaded

init():
  1. Bind module aliases (Engine, Store, Selector, Picker, Shortcuts)
  2. Load settings via Store.getSettings()
  3. Apply CSS custom properties to :root
  4. Shortcuts.init(shortcutSettings(), shortcutActionMap)
  5. restoreBlurredElements()
  6. chrome.runtime.onMessage.addListener(handleMessage)
  7. startDomObserver()
```

### shortcutSettings() — settings flattening

Translates the nested `settings.shortcuts` shape (used in storage) to the flat shape that `PrivacyBlurShortcuts.init()` expects:

```javascript
{
  chordKey:      settings.shortcuts.chordKey1      || "k",
  chordSecond:   settings.shortcuts.chordKey2      || "v",
  chordModifier: settings.shortcuts.chordModifier  || "ctrl"
}
```

### MutationObserver — dynamic content in blur-all mode

When `isPageBlurred` is true, a MutationObserver fires on `childList` changes to `document.body`. Each newly added `Element` node (and all its descendants) is checked against the active blur categories via `Engine.matchesActiveCategories(node, settings.blurCategories)` before being passed to `Engine.applyBlur()`. Nodes that do not match any active category are skipped. The observer is dormant when the picker is active.

### Settings shape (local state)

| Key | Type | Purpose |
|---|---|---|
| `blurRadius` | `number` | Pixel radius for CSS blur filter |
| `highlightColor` | `string` | Hex colour for picker hover highlight |
| `transitionDuration` | `number` | Milliseconds for blur transition |
| `revealOnHover` | `boolean` | Whether hovering reveals blurred content |
| `enabled` | `boolean` | Global on/off toggle |
| `shortcuts` | `object` | Nested chord shortcut config (see §5) |
| `blurCategories` | `BlurCategories` | Which element categories participate in blur-all mode |

### CSS custom properties applied to `:root`

| Property | Value | Used by |
|---|---|---|
| `--pb-radius` | `${blurRadius}px` | `.pb-blurred { filter: blur(var(--pb-radius)) }` |
| `--pb-highlight-color` | `#f59e0b` (default) | `.pb-hover-highlight` outline |
| `--pb-transition-duration` | `200ms` (default) | `.pb-blurred` transition |

### Message handler — type dispatch table

| Message type | Action |
|---|---|
| `TOGGLE_BLUR_ALL` | `Engine.blurAllContent()` or `Engine.unblurAll()`, toggles `isPageBlurred` |
| `TOGGLE_PICKER` | `Picker.activate()` or `Picker.deactivate()`, toggles `isPickerActive` |
| `CLEAR_ALL_BLUR` | `Engine.unblurAll()`, `Store.clearHost(hostname)` |
| `RESTORE` | `restoreBlurredElements()` — async, returns true |
| `GET_STATUS` | Returns `{isPageBlurred, isPickerActive, blurredCount}` |
| `UPDATE_SETTINGS` | Merges settings, re-inits shortcuts, updates CSS properties |
| `CONTEXT_BLUR` | `Selector.restoreSelector()` → `Engine.applyBlur()` → `Store.saveBlurredElement()` |
| `CONTEXT_UNBLUR` | `Selector.restoreSelector()` → `Engine.removeBlur()` → `Store.removeBlurredElement()` |

---

## 8. background.js

### Message handlers

| Message type | Storage operation |
|---|---|
| `GET_SELECTORS` | `storage.get("blurred_selectors")` → return `map[hostname] \|\| []` |
| `SAVE_SELECTOR` | `storage.get` → deduplicate → push → `storage.set` |
| `REMOVE_SELECTOR` | `storage.get` → filter out → `storage.set` |
| `CLEAR_HOST` | `storage.get` → `delete map[hostname]` → `storage.set` |
| `CLEAR_ALL` | `storage.set({ blurred_selectors: {} })` |
| `GET_SETTINGS` | `storage.get("settings")` → `deepMerge(DEFAULT_SETTINGS, saved)` |
| `SAVE_SETTINGS` | `storage.get("settings")` → `deepMerge(current, partial)` → `storage.set` |

All handlers return `true` to keep the message channel open for the async `sendResponse` callback.

### deepMerge

Recursive object merge (second wins). Arrays are replaced, not concatenated. Non-object values are assigned directly.

---

## 9. styles/content.css

### CSS Custom Properties (set by content_script on `:root`)

```css
:root {
  --pb-radius: 8px;
  --pb-highlight-color: #f59e0b;
  --pb-transition-duration: 200ms;
}
```

### Core blur rule

```css
.pb-blurred {
  filter: blur(var(--pb-radius, 8px)) !important;
  -webkit-filter: blur(var(--pb-radius, 8px)) !important;
  transition: filter var(--pb-transition-duration, 200ms) ease !important;
  overflow: hidden !important;
  will-change: filter !important;
}
```

### Reveal-on-hover

Applied by toggling `.pb-reveal-on-hover` class on the element:

```css
.pb-reveal-on-hover:hover {
  filter: none !important;
  -webkit-filter: none !important;
}
```

### Toolbar isolation

```css
.pb-toolbar {
  all: initial;    /* reset ALL inherited/computed styles from the page */
  /* then re-apply extension styles */
}
```

---

## 10. Test Architecture

### Unit tests (tests/unit/)

Each test file:
1. Tries to load the real source file from `src/`.
2. If missing, falls back to an inline stub that satisfies the same contract.
3. Uses `(0, eval)(src)` — not `vm.runInThisContext` — so the code runs in Jest's jsdom context where `window === global`.

### Setup (tests/setup.js)

| Mock | Why |
|---|---|
| `global.window = global` | IIFEs assign to `window.PrivacyBlur*`; jsdom doesn't alias `window` to Node's `global` |
| `global.chrome = { ... }` | Full `chrome.*` API mock with `jest.fn()` for all used methods |
| `HTMLCanvasElement.prototype.getContext` | jsdom doesn't implement canvas — returns a fake 2D context so video tests don't throw |
| `global.requestAnimationFrame` | No-op that returns incrementing handles; video animation loop must not auto-execute |
| `global.cancelAnimationFrame` | Recorded by jest.fn() so `removeBlur(video)` tests can assert cancellation |
| `beforeEach(() => jest.clearAllMocks())` | Resets call counts between tests |

### Coverage thresholds

Enforced in `jest.config.js`:
```javascript
coverageThreshold: {
  global: { lines: 70, functions: 70 }
}
```
Measured against `src/**/*.js` only.
