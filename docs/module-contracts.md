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
| `CATEGORY_SELECTORS` | `Record<string, { alwaysBlur: string[], textCheck: string[], roles?: string[] }>` | Maps each category to unconditional + text-check tag arrays and optional ARIA roles. Frozen constant. |
| `selectorCache` | `{ key, alwaysBlurSelector, textCheckSelector, tagSet, roleSet } \| null` | Cached selector strings + Sets keyed by 5-bit category toggle string; rebuilt on cache miss. |
| `_isPageBlurred` | `boolean` | Whether blur-all is currently active. Set only by `handleSite`. |
| `_observers` | `WeakMap<Document|ShadowRoot, MutationObserver>` | One observer per active root. WeakMap auto-GCs when a detached shadow root is collected. |
| `_handling` | `boolean` | Mutex — drops concurrent `handleSite` calls. |
| `_currentSettings` | `object \| null` | Latest settings snapshot; read by MO callback when stamping newly-added nodes. |
| `_activeItems` | `Map<string, object>` | Items currently applied to the DOM, keyed by selector (dynamic) or id (sticky). Diffed on every reconcile. |
| `_lastReconcileKey` | `string \| null` | Fingerprint of last page-wide reconcile inputs. Lets `handleSite` skip the nuke+rescan when only CSS vars changed. |
| `_dynamicCounter` | `number` | High-water mark for dynamic item names ("Dynamic N"). |
| `_stickyCounter` | `number` | High-water mark for sticky item names ("Sticky N"). |

### Public API

```typescript
type BlurCategories = { TEXT: boolean; MEDIA: boolean; FORM: boolean; TABLE: boolean; STRUCTURE: boolean };
type BlurMode = 'blur' | 'frosted' | 'redacted' | 'censored' | null;
type Settings = { ENABLED?: boolean; BLUR_ALL_ACTIVE: boolean; BLUR_ITEMS: object[];
                  BLUR_CATEGORIES: BlurCategories; BLUR_MODE: BlurMode; THOROUGH_BLUR: boolean;
                  BLUR_RADIUS?: number; [key: string]: any };

interface BlurEngine {
  // ── Orchestration ──────────────────────────────────────────────────────────
  handleSite(settings: Settings): Promise<void>;
  handleMainDocument(settings: Settings): Promise<ShadowRoot[]>;       // main doc only
  handleShadowRoot(settings: Settings, sr: ShadowRoot): Promise<void>; // one shadow root
  handleIframe(settings: Settings, iframeEl: HTMLIFrameElement): void; // cross-origin only
  handleDocument(settings: Settings, root: Document | ShadowRoot): Promise<void>; // thin router

  // ── CSS injection (per-root) ───────────────────────────────────────────────
  injectRules(root: Document | ShadowRoot, categories: BlurCategories, mode: BlurMode): void;
  removeRules(root: Document | ShadowRoot): void;
  isBlurAllActive(): boolean;           // checks document.head only (light DOM)
  ensureSvgFilter(root: Document | ShadowRoot): void;

  // ── DOM stamping ───────────────────────────────────────────────────────────
  stampElements(root: Document | ShadowRoot, categories: BlurCategories,
                thorough: boolean, mode: BlurMode): ShadowRoot[];
  tryBlurTextCheck(element: Element, thorough: boolean): void;

  // ── Per-root observation ───────────────────────────────────────────────────
  observeRoot(root: Document | ShadowRoot): void;
  disconnectObserver(root: Document | ShadowRoot): void;
  teardown(root: Document | ShadowRoot): void;

  // ── Individual element (picker / context menu) ─────────────────────────────
  applyBlur(element: Element): void;
  removeBlur(element: Element): void;
  toggleBlur(element: Element): void;
  unblurAll(): void;   // alias: teardown(document) + removeAllZoneOverlays

  // ── Queries ────────────────────────────────────────────────────────────────
  isBlurred(element: Element): boolean;         // stamped OR tag-rule (light DOM only)
  isVisuallyBlurred(element: Element): boolean; // isBlurred + role-rule (reveal walks)
  matchesActiveCategories(element: Element, categories?: BlurCategories): boolean;
  shouldBlurElement(element: Element, categories?: BlurCategories, thorough?: boolean): boolean;
  get isPageBlurred(): boolean;

  // ── Sticky zones ───────────────────────────────────────────────────────────
  createZoneOverlay(zoneData: object): HTMLElement | null;
  removeZoneOverlay(zoneId: string): void;
  getZoneOverlays(): HTMLElement[];
  removeAllZoneOverlays(): void;

  // ── Counter allocation (picker callbacks) ──────────────────────────────────
  resetCounters(): void;
  allocateDynamicName(): string;
  allocateStickyName(): string;

  // ── Internal (exposed for unit tests) ─────────────────────────────────────
  CATEGORY_SELECTORS: object;
  _setPickerActiveForObserver(v: boolean): void;
}
```

### handleSite — top-level reconcile

```
handleSite(settings)   [async, mutex — drops concurrent calls]
  _currentSettings = settings

  if ENABLED === false:
    handleMainDocument(settings)   // fire-and-forget — teardown is sync inside
    _isPageBlurred = false
    _reconcileItems([])
    removeAllZoneOverlays()
    _lastReconcileKey = null
    return

  isActive = !!BLUR_ALL_ACTIVE
  reconcileKey = isActive
    ? "<BLUR_MODE>|<JSON(BLUR_CATEGORIES)>|<THOROUGH_BLUR>|<BLUR_RADIUS if frosted>"
    : "inactive"
  pageWideChanged = reconcileKey !== _lastReconcileKey
  _lastReconcileKey = reconcileKey

  if pageWideChanged:
    shadowRoots = await handleMainDocument(settings)
    if shadowRoots.length:
      await Promise.all(shadowRoots.map(sr → handleShadowRoot(settings, sr)))
    // iframes: same-origin self-managed via all_frames:true;
    //          cross-origin stamped by handleIframe in observeRoot MO callback

  _isPageBlurred = isActive
  _reconcileItems(BLUR_ITEMS)
```

### handleMainDocument — main document dispatch

```
handleMainDocument(settings)   [async, returns ShadowRoot[]]
  active = ENABLED !== false && BLUR_ALL_ACTIVE
  if !active: teardown(document); return []

  cats = BLUR_CATEGORIES, mode = BLUR_MODE, thorough = THOROUGH_BLUR
  injectRules(document, cats, mode)
  document.querySelectorAll('[data-bl-si-blur]').forEach(el →
    if !el.dataset.blSiPii: delete el.dataset.blSiBlur; _clearMaskAttrs(el)
  )
  shadowRoots = stampElements(document, cats, thorough, mode)
  observeRoot(document)
  return shadowRoots
```

### handleShadowRoot — one shadow root dispatch

```
handleShadowRoot(settings, shadowRoot)   [async, void]
  active = ENABLED !== false && BLUR_ALL_ACTIVE
  if !active: teardown(shadowRoot); return

  cats = BLUR_CATEGORIES, mode = BLUR_MODE, thorough = THOROUGH_BLUR
  injectRules(shadowRoot, cats, mode)
  shadowRoot.querySelectorAll('[data-bl-si-blur]').forEach(el →
    if !el.dataset.blSiPii: delete el.dataset.blSiBlur; _clearMaskAttrs(el)
  )
  nested = stampElements(shadowRoot, cats, thorough, mode)
  observeRoot(shadowRoot)
  if nested.length: await Promise.all(nested.map(sr → handleShadowRoot(settings, sr)))
```

### handleIframe — cross-origin iframe black-box blur

```
handleIframe(settings, iframeEl)   [sync, void]
  if !iframeEl || _isExtensionUI(iframeEl): return
  active = ENABLED !== false && BLUR_ALL_ACTIVE

  // Try contentDocument — throws SecurityError for cross-origin
  isSameOrigin = false
  try: isSameOrigin = !!iframeEl.contentDocument; catch: (swallow)
  if isSameOrigin: return   // all_frames:true — iframe's own content_script handles it

  if active: iframeEl.dataset.blSiBlur = '1'
  else: delete iframeEl.dataset.blSiBlur
```

### handleDocument — thin router (backward compat)

```
handleDocument(settings, root)   [async]
  if !root || root === document: return handleMainDocument(settings)
  if root instanceof ShadowRoot:  return handleShadowRoot(settings, root)
```

### stampElements — stamp + shadow root discovery

```
stampElements(root, categories, thorough, mode)   [sync, returns ShadowRoot[]]
  rebuild _textCheckSet from categories
  shadowRoots = []

  root.querySelectorAll('*').forEach(el →
    if el.shadowRoot: shadowRoots.push(el.shadowRoot)   // piggybacked discovery
    tag = el.tagName.toLowerCase()
    if !_textCheckSet.has(tag): return
    if el.dataset.blSiBlur: return   // already stamped
    if _isExtensionUI(el): return
    needsTextGate = _structuralTags.has(tag)
    shouldStamp = needsTextGate
      ? hasMeaningfulTextContent(el)
      : thorough || hasMeaningfulTextContent(el)
    if shouldStamp:
      el.dataset.blSiBlur = "1"
      if mode === MASKED: _stampMaskText(el)
  )

  return shadowRoots
```

### teardown — recursive cleanup

```
teardown(root)   [sync]
  disconnectObserver(root)
  removeRules(root)

  // ONE pass: clear stamps + collect shadow hosts for post-loop recursion
  shadowHosts = []
  root.querySelectorAll('*').forEach(el →
    if el.dataset.blSiBlur && !el.dataset.blSiPii:
      delete el.dataset.blSiBlur; _clearMaskAttrs(el)
    if el.shadowRoot: shadowHosts.push(el)
  )
  remove SVG filter (#bl-si-svg-filters) if present in root
  shadowHosts.forEach(h → teardown(h.shadowRoot))
```

### Shadow DOM notes

- `injectRules` / `removeRules` use `root.head ?? root` — works for both document (styles → `<head>`) and shadow roots (no `.head` → styles go directly into the root).
- CSS custom properties (`--bl-si-radius`, etc.) set on `:root` in the light DOM are inherited into open shadow roots — no extra propagation needed.
- `isBlurAllActive()` checks `document.head` only. AlwaysBlur elements inside shadow roots are blurred via CSS injected into each shadow root, but `isBlurred()` / `isVisuallyBlurred()` cannot detect this (they are unaware of which root an element lives in). Picker and reveal interactions with shadow-root elements are therefore not supported in Phase 1 (see Known Limitations in `CLAUDE.md`).
- MO callback guards new shadow hosts with `!_observers.has(sr)` before calling `handleShadowRoot` — prevents re-processing already-active roots on every MO tick.
- MO callback also calls `handleIframe` for dynamically inserted `<iframe>` elements — cross-origin iframes are stamped as blur black-boxes; same-origin iframes are skipped (their own content_script handles blur via `all_frames:true`).

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

## 4b. storage_model.js (current — replaces storage_manager.js)

`blsi.Model` — single source of truth for all persisted state. Direct `chrome.storage.local` access under key `blsi_model`. No background relay.

### Snapshot API (site-rules snapshot redesign)

SNAPSHOT_KEYS — the set of user-configurable keys captured into a site rule:

```
blur_radius     — from m.settings.blur_radius
blur_mode       — from m.blur_all.settings.blur_mode
reveal_mode     — from m.settings.reveal_mode
thorough_blur   — from m.settings.thorough_blur
blur_categories — from m.settings.blur_categories (object, deep copy)
pick_blur_type  — from m.pick_and_blur.settings.blur_type
pick_blur_color — from m.pick_and_blur.settings.blur_color (object, deep copy)
pii_mode        — from m.auto_detect_pii.settings.pii_mode
```

```typescript
capture_snapshot() → object
  // Returns plain object with exactly SNAPSHOT_KEYS populated from cache.
  // blur_categories and pick_blur_color are deep copies.
  // Source is always the in-memory cache (get()).

save_site_snapshot(hostname_value: string, hostname_type: string, snapshot: object) → Promise<void>
  // Finds rule where r.hostname_value === hostname_value && r.hostname_type === hostname_type.
  // If found: replaces r.settings with snapshot.
  // If not found: creates new entry (hostname_type honoured).
  // No-op if hostname_value is empty/non-string or snapshot is null/non-object.

clear_site_snapshot(hostname_value: string, hostname_type: string) → Promise<void>
  // Resets r.settings to {} for the matching rule. No-op if rule not found.
  // Other rule fields (blur_all, items) are NOT changed.

get_site_snapshot(hostname_value: string, hostname_type: string) → object | null
  // Returns r.settings if non-empty, else null.
  // Synchronous read from cache.
```

### resolve() — snapshot merging

`resolve(hostname, url)` already handles populated `site_rules[i].settings` via `Object.assign(resolved, rule.settings)`. The merge order (later wins):

```
global settings → feature settings → wildcard/regex rule.settings → exact rule.settings
```

A full snapshot in `rule.settings` overrides all SNAPSHOT_KEYS for the resolved output. No changes to `resolve()` were needed — the snapshot design was chosen to be forward-compatible.

### validate_model() — snapshot validation

`validate_model()` validates `site_rules[i].settings`:
- Only SNAPSHOT_KEYS are passed through (unknown keys are dropped).
- `blur_categories`: validates each boolean value; invalid entries fall back to `DEFAULT_MODEL` defaults.
- `pick_blur_color`: validates `hex` (6-char hex) and `opacity` (0–1); invalid values fall back to defaults.
- Scalar keys (`blur_radius`, `blur_mode`, `reveal_mode`, `thorough_blur`, `pick_blur_type`, `pii_mode`) are passed through as-is; `resolve()` applies per-feature coercion when building the resolved view.
- Empty `{}` settings survive validate_model as `{}` (no inflation to defaults).

---

## 5. shortcut_handler.js (v2)

### State

| Variable | Type | Purpose |
|---|---|---|
| `activeKeydownListener` | `Function \| null` | Reference to the installed keydown handler |
| `activeBlurListener` | `Function \| null` | Window blur hook (reserved for sequence state reset in phase 2) |
| `registeredShortcuts` | `Array<{ actionId, code, mods, bindingKey }>` | Parsed single-chord shortcuts for O(n) match |
| `registeredCallbacks` | `Record<string, Function>` | Action callbacks + `onExitPicker` |
| `currentToastEl` | `Element \| null` | Currently displayed toast element |
| `_isPickerActive` | `boolean` | Set by content_script when picker opens/closes |
| `globalThis.__blsiShortcutFire` | `Record<string, number>` | Per-action monotonic fire token (performance.now()) used by content_script to dedup the JS matcher against chrome.commands relays |

### Public API

```typescript
interface BlurrySiteShortcuts {
  init(shortcuts: Record<string, ShortcutEntry>, callbacks: ShortcutCallbacks): void;
  destroy(): void;
  showToast(text: string, duration?: number): void;
  _setPickerActive(active: boolean): void;
  _getFireToken(): Record<string, number>;
}

interface ShortcutEntry {
  binding: Array<Chord>;  // Array of chords. Phase 1: length === 1. Phase 2: sequences.
}

interface Chord {
  code: string;              // W3C KeyboardEvent.code, e.g. "KeyB", "Enter", "F5"
  mods: Array<"Alt" | "Control" | "Meta" | "Shift">;  // Sorted. No left/right.
}

interface ShortcutCallbacks {
  [actionId: string]: (() => void) | undefined;
  onExitPicker?: () => void;
}
```

### Matching algorithm

```
init(shortcuts, callbacks)
  destroy()
  registeredCallbacks = callbacks
  for each [actionId, entry] in shortcuts:
    if entry.binding.length !== 1 → skip (phase 2)
    chord = entry.binding[0]
    push { actionId, code: chord.code, mods: sort(chord.mods), bindingKey }

  onKeyDown(event):
    if event.repeat                              → return
    if event.isComposing                         → return
    if event.key in {"Dead","Process","Unidentified"} → return
    if event.getModifierState("AltGraph")        → return
    if event.code === "Escape":
      if _isPickerActive → callbacks.onExitPicker?.(), _isPickerActive = false
      return
    if event.code in blsi.MODIFIER_CODES          → return (wait for non-mod)

    mods = []
    if event.altKey   push "Alt"
    if event.ctrlKey  push "Control"
    if event.metaKey  push "Meta"
    if event.shiftKey push "Shift"
    // Already alphabetical because the pushes are in that order.

    for each registered shortcut sc:
      if sc.code !== event.code      → skip
      if !sameArray(sc.mods, mods)   → skip
      event.preventDefault()
      __blsiShortcutFire[sc.actionId] = performance.now()
      callbacks[sc.actionId]?.()
      showToast("Blurry Site — " + blsi.Actions.get(sc.actionId).label)
      return

  attach keydown at capture phase on document
```

### Key differences from v1

- No held-key Set. Modifier state comes from `event.altKey/ctrlKey/metaKey/shiftKey` — the correct source per MDN.
- No `primaryModifier`/`keys[]` split. All modifiers live in one sorted `mods` array.
- Side-agnostic: `AltLeft` and `AltRight` both satisfy a binding with `mods:["Alt"]`.
- Added guards for `Process`, `Unidentified`, and pure-modifier keydowns.
- Toast label comes from `blsi.Actions.get(id).label` — no hardcoded `ACTION_LABELS` map.
- `__blsiShortcutFire[id]` token replaces the 300ms time-window dedup in content_script.

### showToast

Creates a `<div class="bl-si-toast">` at bottom-right, appends to body, fades out after `duration` ms with a CSS animation, then removes from DOM.

---

## 5b. action_registry.js

### Public API

```typescript
interface BlurrySiteActions {
  ACTIONS: Readonly<Record<string, Action>>;  // frozen
  list(): Action[];
  get(id: string): Action | undefined;
  ids(): string[];
  defaultBindings(): Record<string, ShortcutEntry>;  // mutable clone
}

interface Action {
  id: string;                  // e.g. "TOGGLE_BLUR_ALL"
  label: string;               // user-facing long label (also used for toast)
  description: string;         // help overlay description
  defaultBinding: Chord[];     // frozen
  messageType: string;         // content_script dispatch
  chromeCommand: string;       // manifest.json > commands id
}
```

### Invariants

- `ACTIONS` is frozen. Entries are frozen. `defaultBinding` arrays are frozen.
- `defaultBindings()` always returns a fresh deeply-mutable clone. Mutating it never affects the registry.
- Adding a new action requires exactly one edit (a new entry in `ACTIONS`) plus a corresponding handler in `content_script.shortcutActionMap` and (optional) `manifest.json > commands` entry.

---

## 5c. shortcut_label.js

### Public API

```typescript
interface BlurrySiteShortcutLabel {
  CODE_TO_LABEL: Readonly<Record<string, string>>;
  IS_MAC: boolean;  // computed once at module load
  modLabel(mod: "Alt" | "Control" | "Meta" | "Shift"): string;
  codeLabel(code: string): string;
  chordLabel(chord: Chord): string;    // e.g. "⌥⇧B" on Mac, "Alt+Shift+B" on Win
  bindingLabel(binding: Chord[]): string;   // chords joined by " "
  chordKey(chord: Chord): string;      // e.g. "Alt+Shift|KeyB" — for conflict detection
  bindingKey(binding: Chord[]): string;  // multi-chord canonical key
}
```

### Platform rendering

| Modifier | Mac glyph | Windows/Linux name |
|---|---|---|
| Control | `⌃` | `Ctrl` |
| Alt | `⌥` | `Alt` |
| Shift | `⇧` | `Shift` |
| Meta | `⌘` | `Win` |

Mac chords concatenate without separators (`⌘⇧K`); Windows/Linux chords are joined by `+` (`Ctrl+Shift+K`). Binding-level (sequences) always uses a space separator regardless of platform.

### Canonical chord key

`chordKey` sorts mods alphabetically and joins them with `+`, then appends `|` and the code:

```
{ code: "KeyB", mods: ["Alt", "Shift"] } → "Alt+Shift|KeyB"
{ code: "KeyB", mods: ["Shift", "Alt"] } → "Alt+Shift|KeyB"  // same
```

This is used by the popup's conflict-detection logic to compare chords via string equality.

---

## 5d. shortcut_reserved.js

### Public API

```typescript
interface BlurrySiteShortcutReserved {
  RESERVED: Readonly<Array<{ key: string; label: string; platform: "any" | "mac" | "win" }>>;
  isReserved(chord: Chord): boolean;
  lookup(chord: Chord): { label: string } | null;
}
```

### Policy

- Minimal curated list (~12 entries): Ctrl+T, Ctrl+N, Ctrl+W, Ctrl+Tab, Ctrl+Shift+T, Ctrl+Shift+N, F5, F11, F12, Alt+F4 (Win-only), Meta+Q/W/M/H (Mac-only).
- Platform filter applied at query time via `blsi.ShortcutLabel.IS_MAC`.
- Not a deny list — the capture UI shows an inline warning but always allows save. Users can override intentionally (VS Code / JetBrains philosophy).
- Ctrl+Alt+* is **not** in this list — it's rejected outright by `validateSettings` and the capture UI as a correctness fix for European AltGr, not a policy.

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
| `AUTO_DETECT` | `object` | `{ EMAIL, PHONE, SSN, CREDIT_CARD, FINANCIAL }` — all boolean, default false; popup master toggle sets all 5 atomically |

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
