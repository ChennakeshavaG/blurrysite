# Blurry Site — Low-Level Design

## 1. Module Contracts

Each source module is an IIFE that assigns exactly one global on `window`. Modules have no direct imports or exports — they communicate only through their public API. The load order defined in `manifest.json` ensures dependencies are available when a module initialises.

**Load order:**
```
constants.js         → globalThis.blsi (message types + DEFAULTS)
logger.js            → blsi.Logger
url_matcher.js       → blsi.UrlMatcher
selector_utils.js    → blsi.SelectorUtils
storage_manager.js   → blsi.Storage
blur_engine.js       → blsi.BlurEngine
reveal_controller.js → blsi.Reveal
shortcut_handler.js  → blsi.Shortcuts
picker.js            → blsi.Picker
content_script.js    → (orchestrator, no global)
```

### Modules added in the 2026-04 content_script slim refactor

**`blsi.UrlMatcher`** (`src/url_matcher.js`) — pure URL pattern matching:
```ts
interface UrlMatcher {
  matchesPattern(url: string, pattern: string, patternType: 'wildcard' | 'regex'): boolean;
  resolveSettings(url: string, globalSettings: object, rules: Rule[]): object;
  MAX_PATTERN_LENGTH: 500;
}
```
Wildcard mode: parse-then-match (scheme / hostname / port / path) with domain-boundary awareness — `"example.com"` does not match `"notexample.com"`. Regex mode rejects nested quantifiers (`(a+)+`, `a**`) to block ReDoS. `resolveSettings` deep-merges `DEFAULT_SETTINGS` → `globalSettings` → first matching rule's partial settings.

**`blsi.Reveal`** (`src/reveal_controller.js`) — temporary reveal-on-click / reveal-on-hover subsystem:
```ts
interface Reveal {
  init(opts: { getMode: () => 'click'|'hover'|'none', isPickerActive: () => boolean }): void;
  destroy(): void;
  clearAll(): void;
}
```
Owns all reveal state (click target, hover target, ancestor chain, 50ms mouseout debounce, revealed descendants Set). `getMode` and `isPickerActive` are **functions** so the caller never re-inits on settings change. `clearAll()` wipes every piece of state and is called from `applyState` on REVEAL_MODE change or disable.

**Folded into `blsi.BlurEngine`** (previously lived in content_script): `applyItem`, `removeItem`, `resetCounters`, `allocateDynamicName`, `allocateStickyName`, `enableBlurAll`, `disableBlurAll`, `refreshBlurAll`, `get isPageBlurred`, `_setPickerActiveForObserver`. Private state: `_isPageBlurred`, `_domObserver`, `_dynamicCounter`, `_stickyCounter`, `_pickerActive`, `_currentSettings`. The MutationObserver is gated by `_pickerActive` (set via `_setPickerActiveForObserver(v)` from content_script) and reads `_currentSettings.THOROUGH_BLUR` fresh on every callback.

---

## 2. blur_engine.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `videoOverlayMap` | `WeakMap<Element, {canvas, animFrameId}>` | Tracks canvas overlays and RAF handles for video elements |
| `CATEGORY_SELECTORS` | `Record<string, { alwaysBlur: string[], textCheck: string[] }>` | Maps each category to unconditional and text-check tag arrays (frozen constant) |
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

type BlurMode = 'gaussian' | 'frosted';

interface PrivacyBlurEngine {
  applyBlur(element: Element, radius?: number, mode?: BlurMode): void;
  removeBlur(element: Element): void;
  toggleBlur(element: Element, radius?: number, mode?: BlurMode): void;
  blurAllContent(radius?: number, options?: { categories?: BlurCategories, thoroughBlur?: boolean, blurMode?: BlurMode }): void;
  unblurAll(): void;
  isBlurred(element: Element): boolean;          // stamped OR tag-rule
  isVisuallyBlurred(element: Element): boolean;  // isBlurred + role-rule (reveal-only)
  invalidateSelectorCache(): void;
  matchesActiveCategories(element: Element, categories?: BlurCategories): boolean;
  ensureSvgFilter(): void;
  createZoneOverlay(zoneData: { id: string; x: number; y: number; width: number; height: number; [key: string]: any }): HTMLElement | null;
  removeZoneOverlay(zoneId: string): void;
  getZoneOverlays(): HTMLElement[];
  removeAllZoneOverlays(): void;
}
```

### applyBlur — element dispatch

```
applyBlur(el, radius = 8, mode)
  if el is null or not Element → return
  if isBlurred(el) → return (idempotent)
  isFrosted = mode === 'frosted'
  
  tag = el.tagName.toLowerCase()
  
  if tag === "video":
    el.classList.add(BLURRED_CLASS)
    startVideoBlurCanvas(el, radius)
    
  elif tag === "img":
    el.classList.add(BLURRED_CLASS)
    
  elif backgroundImage !== "none":
    el.classList.add(BLURRED_CLASS)
    
  else:
    wrapTextNodes(el)  // wrap bare text nodes in <span class="bl-si-text-node-wrapper">
    el.classList.add(BLURRED_CLASS)
```

### Video canvas overlay

```
startVideoBlurCanvas(videoElement, radius)
  stop any existing overlay (stopVideoBlurCanvas)
  canvas = createElement("canvas")
  canvas.className = "bl-si-canvas-overlay"
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

### blurAllContent — category-based two-pass

```
blurAllContent(radius = 8, options = {})
  categories = options.categories || all-categories-ON
  thoroughBlur = options.thoroughBlur || false

  // Build/cache combined selector from active CATEGORY_SELECTORS
  // Selector cache is keyed by a 5-bit category toggle string; rebuilt on change.

  // Pass 1 — alwaysBlur tags: query combined selector, applyBlur each match
  for each active category:
    querySelectorAll(alwaysBlur tags joined by comma)
    applyBlur(el, radius) for each result

  // Pass 2 — textCheck tags: query, filter by hasMeaningfulTextContent
  for each active category:
    querySelectorAll(textCheck tags joined by comma)
    if hasMeaningfulTextContent(el) OR thoroughBlur:
      applyBlur(el, radius)
```

### CSS class constants

| Constant | Value |
|---|---|
| `BLURRED_CLASS` | `"bl-si-blurred"` |
| `CANVAS_CLASS` | `"bl-si-canvas-overlay"` |
| `TEXT_WRAPPER_CLASS` | `"bl-si-text-node-wrapper"` |

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

  // Strategy 2: stamp data-bl-si-id
  if element.dataset.blSiId is empty:
    element.dataset.blSiId = generateId()   // 8-char hex UUID
  return '[data-bl-si-id="' + element.dataset.blSiId + '"]'
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

No local `DEFAULT_SETTINGS`. Uses `MSG.DEFAULT_SETTINGS` and `MSG.buildDefaultSettings()` from `constants.js` (referenced as `window.BlurrySite`). All settings keys are UPPER_SNAKE_CASE.

### Public API

```typescript
type BlurItemType = 'dynamic' | 'sticky';

interface BlurItem {
  type: BlurItemType;
  name: string;
  selector?: string;
  id?: string;
  [key: string]: any;
}

interface PrivacyBlurStorage {
  saveBlurItem(hostname: string, item: BlurItem): Promise<any>;
  removeBlurItem(hostname: string, itemId: string): Promise<void>;
  getBlurItems(hostname: string): Promise<BlurItem[]>;
  clearHost(hostname: string): Promise<void>;
  clearAll(): Promise<void>;
  getSettings(): Promise<object>;
  saveSettings(fullSettings: object): Promise<void>;
  getRules(): Promise<Array>;
  saveRules(rules: Array): Promise<void>;
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

### saveSettings — full-object write

```
saveSettings(fullSettings)
  if fullSettings is null or not object → return
  await send({ type: "SAVE_SETTINGS", settings: fullSettings })
```

No partial merge — caller must pass the complete settings object.

### getSettings — passthrough

```
getSettings()
  response = await send({ type: "GET_SETTINGS" })
  return response.settings || MSG.buildDefaultSettings()
```

Background merges stored settings over `DEFAULT_SETTINGS` before responding, so the result is always complete. Falls back to a fresh default clone if background is unreachable.

### getRules / saveRules — URL rules CRUD

```
getRules()
  response = await send({ type: "GET_RULES" })
  return response.rules || []

saveRules(rules)
  if rules is not Array → return
  await send({ type: "SAVE_RULES", rules })
```

---

## 5. shortcut_handler.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `heldKeys` | `Set<string>` | Set of `event.code` values currently held down |
| `activeKeydownListener` | `Function \| null` | Reference to the installed keydown handler |
| `activeKeyupListener` | `Function \| null` | Reference to the installed keyup handler |
| `activeBlurListener` | `Function \| null` | Reference to the window blur handler |
| `registeredShortcuts` | `Array<{ actionName, primaryModifier, keyCodes }>` | Parsed shortcuts for fast iteration |
| `registeredCallbacks` | `Record<string, Function>` | Action callbacks + `onExitPicker` |
| `currentToastEl` | `Element \| null` | Currently displayed toast element |
| `_isPickerActive` | `boolean` | Set by content_script when picker opens/closes |

### Public API

```typescript
interface PrivacyBlurShortcuts {
  init(shortcuts: Record<string, ShortcutBinding>, callbacks: ShortcutCallbacks): void;
  destroy(): void;
  showToast(text: string, duration?: number): void;
  _setPickerActive(active: boolean): void;
}

interface ShortcutBinding {
  primaryModifier: string;  // event.code of the modifier, e.g. "AltLeft"
  keys: Array<{ key: string; code: string }>;  // additional keys required
}

interface ShortcutCallbacks {
  TOGGLE_BLUR_ALL?: () => void;
  TOGGLE_PICKER?: () => void;
  CLEAR_ALL?: () => void;
  onExitPicker?: () => void;
}
```

### init — held-key matching logic

```
init(shortcuts, callbacks)
  destroy()  // detach any existing listeners, clear heldKeys

  registeredCallbacks = callbacks
  registeredShortcuts = parse shortcuts into flat array:
    for each [actionName, binding] in shortcuts:
      push { actionName, primaryModifier: binding.primaryModifier,
             keyCodes: binding.keys.map(k => k.code) }

  onKeyDown(event):
    if event.repeat or event.isComposing or event.key === "Dead" → return
    if getModifierState("AltGraph") → return (dead-key AltGr guard)

    heldKeys.add(event.code)

    if event.key === "Escape":
      if _isPickerActive → callbacks.onExitPicker?.(), _isPickerActive = false
      return

    for each registered shortcut sc:
      if !isPrimaryModifierHeld(event, sc.primaryModifier) → skip
      if any code in sc.keyCodes not in heldKeys → skip
      // All keys held — match found
      event.preventDefault()
      callbacks[sc.actionName]?.()
      showToast("BlurrySite: " + ACTION_LABELS[sc.actionName])
      return

  onKeyUp(event):
    heldKeys.delete(event.code)

  onWindowBlur():
    heldKeys.clear()

  attach keydown + keyup at capture phase, window blur at bubble phase
```

### isPrimaryModifierHeld

Checks both the event boolean property (e.g. `event.altKey`) and the specific side via `heldKeys.has(modifierCode)`. CapsLock uses `getModifierState('CapsLock')`.

### showToast

Creates a `<div class="bl-si-toast">` at bottom-right, appends to body, fades out after `duration` ms with a CSS animation, then removes from DOM.

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
  
  document.documentElement.classList.add("bl-si-picker-active")
  buildToolbar()  // creates #bl-si-picker-toolbar, appends to document.body
  
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

  if target.classList.contains("bl-si-blurred"):
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

Creates a `<div id="bl-si-picker-toolbar">` with:
- Left: status label text
- Right: "Clear all" button + "×" close button
- Appended to `document.body`
- Captures `mouseover`, `mouseout`, `click` on itself to prevent picker events propagating into it

---

## 7. content_script.js

### State

Two settings objects coexist:

| Variable | Type | Purpose |
|---|---|---|
| `globalSettings` | `object` | User-configured settings from storage (no URL rule overrides) |
| `settings` | `object` | Resolved settings: URL rule overrides > global > defaults |
| `rules` | `Array` | URL rules loaded from storage |
| `isPageBlurred` | `boolean` | Whether blur-all mode is active |
| `isPickerActive` | `boolean` | Whether the element picker is open |
| `observerSelector` | `string` | Combined CSS selector for MutationObserver queries, built from CATEGORY_SELECTORS |

### Initialisation sequence

```
if DOM not ready → wait for DOMContentLoaded

init():
  1. Bind module aliases (Engine, Store, Selector, Picker, Shortcuts)
  2. Load settings and URL rules via Promise.all([Store.getSettings(), Store.getRules()])
  3. Resolve settings: resolveSettings(location.href, globalSettings, rules)
  4. Apply CSS custom properties to :root (applySettingsToDom)
  5. Register message listener: chrome.runtime.onMessage.addListener(handleMessage)
  6. Track contextmenu target for context menu blur/unblur
  7. If ENABLED === false → return early
  8. Shortcuts.init(settings.SHORTCUTS, shortcutActionMap) — no flattening needed
  9. restoreBlurredElements(), startDomObserver(), register reveal handlers
```

### resolveSettings — URL rule priority

```
resolveSettings(url, globalSettings, urlRules)
  resolved = deepMerge(DEFAULT_SETTINGS, globalSettings)
  for each rule in urlRules:
    if matchesPattern(url, rule.pattern, rule.patternType):
      resolved = deepMerge(resolved, rule.settings)
      break  // first match wins
  return resolved
```

### matchesPattern / wildcardToRegex

`matchesPattern(url, pattern, patternType)` supports `"wildcard"` (glob with `*`) and `"regex"` pattern types. Patterns exceeding 500 chars are rejected to prevent ReDoS.

### buildObserverSelector

Builds a combined CSS selector from active `CATEGORY_SELECTORS` (both `alwaysBlur` and `textCheck` tags). Used by MutationObserver to `querySelectorAll` on inserted subtrees instead of iterating all descendants.

### MutationObserver — dynamic content in blur-all mode

When `isPageBlurred` is true, a MutationObserver fires on `childList` changes to `document.body`. Added nodes and their descendants (via `querySelectorAll(observerSelector)`) are queued in batches of 50 and processed via `requestAnimationFrame`. Each node is checked against active categories via `Engine.matchesActiveCategories(node, settings.BLUR_CATEGORIES)` before `Engine.applyBlur()`. The observer is dormant when the picker is active.

### Settings shape (local state) — UPPER_SNAKE_CASE

| Key | Type | Purpose |
|---|---|---|
| `BLUR_RADIUS` | `number` | Pixel radius for CSS blur filter |
| `HIGHLIGHT_COLOR` | `string` | Hex colour for picker hover highlight |
| `TRANSITION_DURATION` | `number` | Milliseconds for blur transition |
| `REVEAL_MODE` | `string` | `"none"` \| `"click"` \| `"hover"` |
| `ENABLED` | `boolean` | Global on/off toggle |
| `THOROUGH_BLUR` | `boolean` | Blur textCheck elements even without meaningful text |
| `SHORTCUTS` | `object` | `{ ACTION_NAME: { primaryModifier, keys } }` (see §5) |
| `BLUR_CATEGORIES` | `object` | `{ TEXT, MEDIA, FORM, TABLE, STRUCTURE }` — which categories participate in blur-all |

### CSS custom properties applied to `:root`

| Property | Value | Used by |
|---|---|---|
| `--bl-si-radius` | `${BLUR_RADIUS}px` | `.bl-si-blurred { filter: blur(var(--bl-si-radius)) }` |
| `--bl-si-highlight-color` | `#f59e0b` (default) | `.bl-si-hover-highlight` outline |
| `--bl-si-transition-duration` | `200ms` (default) | `.bl-si-blurred` transition |

### Message handler — type dispatch table

| Message type | Action |
|---|---|
| `TOGGLE_BLUR_ALL` | `Engine.blurAllContent(radius, { categories, thoroughBlur })` or `Engine.unblurAll()`, toggles `isPageBlurred` |
| `TOGGLE_PICKER` | `Picker.activate()` or `Picker.deactivate()`, toggles `isPickerActive` |
| `CLEAR_ALL_BLUR` | `Engine.unblurAll()`, `Store.clearHost(hostname)` |
| `RESTORE` | `restoreBlurredElements()` — async, returns true |
| `GET_STATUS` | Returns `{isPageBlurred, isPickerActive, blurredCount}` |
| `UPDATE_SETTINGS` | Merges into globalSettings, re-resolves via URL rules, re-inits shortcuts, updates CSS properties. Invalidates selector cache and re-blurs if categories/thoroughBlur changed. |
| `CONTEXT_BLUR` | `Engine.applyBlur(lastContextMenuTarget)` → `Store.saveBlurItem()` |
| `CONTEXT_UNBLUR` | `findBlurredAncestor(target)` → `Engine.removeBlur()` → `Store.removeBlurItem()` |
| `UNBLUR_ITEM` | `querySelector(selector)` → `Engine.removeBlur()` |

---

## 8. background.js

### Message handlers

| Message type | Storage operation |
|---|---|
| `GET_BLUR_ITEMS` | `storage.get("blurred_items")` → return `map[hostname] \|\| []` |
| `SAVE_BLUR_ITEM` | `storage.get` → deduplicate → push → `storage.set` |
| `REMOVE_BLUR_ITEM` | `storage.get` → filter out → `storage.set` |
| `CLEAR_HOST` | `storage.get` → `delete map[hostname]` → `storage.set` |
| `CLEAR_ALL` | `storage.set({ blurred_items: {} })` |
| `GET_SETTINGS` | `storage.get("settings")` → `deepMerge(DEFAULT_SETTINGS, saved)` |
| `SAVE_SETTINGS` | `storage.set({ settings: message.settings })` — full-object write, no partial merge |
| `GET_RULES` | `storage.get("rules")` → return `rules \|\| []` |
| `SAVE_RULES` | `storage.set({ rules: message.rules })` — capped at 100 rules |

All handlers return `true` to keep the message channel open for the async `sendResponse` callback. Write operations use `serialWrite()` to prevent concurrent get-then-set data loss.

### deepMerge

Sourced from `constants.js` (`BlurrySite.deepMerge`). Recursive object merge (second wins) with depth limit (5). Arrays are replaced, not concatenated. Non-object values are assigned directly. Prototype-pollution safe (skips `__proto__`, `constructor`, `prototype`).

---

## 8b. logger.js — flow logging

### State

```ts
let _enabled: boolean;          // false until storage read or enable()
const PREFIX = '[BLSI]';
const STORAGE_KEY = 'blsi_debug';
```

### Public API

```ts
interface Logger {
  log(...args: any[]): void;        // gated
  warn(...args: any[]): void;       // gated
  error(...args: any[]): void;      // ALWAYS logs
  flow(tag: string, data?: any): void; // gated
  scope(name: string): ScopedLogger;
  enable(): void;                   // sets _enabled, persists blsi_debug=true
  disable(): void;                  // sets _enabled, persists blsi_debug=false
  readonly enabled: boolean;
}

interface ScopedLogger {
  log/warn/error/flow: same as above
  readonly enabled: boolean;
}
```

### Cross-context sync

On load, every context (background SW, content script, popup) reads `chrome.storage.local.blsi_debug` and registers a `chrome.storage.onChanged` listener that flips `_enabled` whenever the key changes in the `local` area. This means flipping the toggle in any context propagates to every other live context within one onChanged tick — no reload required.

### Flow log call sites

The following call sites emit `flow()` events when the toggle is on. Format: `[BLSI] HH:MM:SS.mmm [scope] ⟶ tag {data}`.

| Scope | Event | Where | Payload |
|---|---|---|---|
| `content` | `init.start` | `content_script.init` | `{ href, hostname }` |
| `content` | `init.done` | `content_script.init` end | `{ enabled, revealMode, pickerMode, ruleCount }` |
| `content` | `settings.apply` | `content_script.applyState` | `{ changed: string[] }` |
| `content` | `storage.settingsChanged` | `onSettingsChanged` | — |
| `content` | `storage.rulesChanged` | `onRulesChanged` | `{ count }` |
| `content` | `spa.urlChange` | `onUrlChange` | `{ from, to }` |
| `content` | `msg.in` | `handleMessage` | `{ type }` |
| `content` | `trigger.toggleBlurAll` | `TOGGLE_BLUR_ALL` | `{ nextState, hostname }` |
| `content` | `trigger.togglePicker` | `TOGGLE_PICKER` | `{ nextState, mode }` |
| `content` | `trigger.clearAll` | `CLEAR_ALL_BLUR` / shortcut | `{ source, hostname }` |
| `content` | `trigger.contextBlur` / `trigger.contextUnblur` | context menu handlers | `{ name?, selector }` |
| `content` | `picker.blur` / `picker.unblur` | picker callbacks | `{ name?, selector }` |
| `content` | `picker.stickyBlur` / `picker.stickyUnblur` | sticky callbacks | `{ id, name?, rect? }` |
| `content` | `picker.modeChange` / `picker.deactivate` | picker callbacks | `{ mode? }` |
| `engine` | `blurAll` | `blur_engine.blurAll` end | `{ pageActive, pageWideChanged, added, removed, totalActive }` |
| `bg` | `onInstalled` / `onStartup` | background lifecycle | `{ reason? }` |
| `bg` | `command.relay` | `chrome.commands.onCommand` | `{ command, type, tabId }` |
| `bg` | `contextMenu` | `chrome.contextMenus.onClicked` | `{ menuItemId, tabId }` |
| `popup` | `init` | `popup.init` | — |

The toggle button in `popup/popup.html` (`#debugToggle`) flips `Logger.enable()` / `Logger.disable()`. State is mirrored to `data-active` and `aria-pressed`.

---

## 9. styles/content.css

### CSS Custom Properties (set by content_script on `:root`)

```css
:root {
  --bl-si-radius: 8px;
  --bl-si-highlight-color: #f59e0b;
  --bl-si-transition-duration: 200ms;
}
```

### Core blur rule

```css
.bl-si-blurred {
  filter: blur(var(--bl-si-radius, 8px)) !important;
  -webkit-filter: blur(var(--bl-si-radius, 8px)) !important;
  transition: filter var(--bl-si-transition-duration, 200ms) ease,
              -webkit-filter var(--bl-si-transition-duration, 200ms) ease !important;
  /* will-change: filter removed — creates permanent stacking context that
     breaks position:fixed/sticky children and z-index hover elevation. */
}
```

### Reveal modes

**Click-to-reveal** (`bl-si-revealed`): JS adds class on click, removes on second click or Escape.

```css
.bl-si-revealed {
  filter: none !important;
  -webkit-filter: none !important;
  transition: filter calc(var(--bl-si-transition-duration, 200ms) / 2) ease,
              -webkit-filter calc(var(--bl-si-transition-duration, 200ms) / 2) ease !important;
  outline: 2px dashed var(--bl-si-highlight-color, #f59e0b) !important;
  outline-offset: 2px !important;
}
```

**Hover-to-reveal** (`bl-si-reveal-on-hover`): CSS hover removes filter. Only active when content_script adds the class.

```css
.bl-si-reveal-on-hover:hover {
  filter: none !important;
  -webkit-filter: none !important;
}
```

**Ancestor unblur** (`bl-si-ancestor-reveal`): JS adds to blurred ancestors when a descendant is revealed (click or hover). Removes ancestor filter so revealed content is visible through the chain.

```css
.bl-si-ancestor-reveal {
  filter: none !important;
  -webkit-filter: none !important;
}
```

### Toolbar isolation

```css
.bl-si-toolbar {
  all: initial;    /* reset ALL inherited/computed styles from the page */
  /* then re-apply extension styles */
}
```

---

## 10. Test Architecture

### Unit tests (tests/unit/)

Each test file:
1. Uses `require(MODULE_PATH)` to load the real source file (enables Jest coverage instrumentation).
2. If the source file is missing, falls back to `(0, eval)(buildStubSource())` with an inline stub that satisfies the same contract.
3. The `require()` approach runs the IIFE in Jest's jsdom context where `window === global`, so `window.BlurrySite*` assignments work correctly.

### Setup (tests/setup.js)

| Mock | Why |
|---|---|
| `global.window = global` | IIFEs assign to `window.BlurrySite*`; jsdom doesn't alias `window` to Node's `global` |
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
