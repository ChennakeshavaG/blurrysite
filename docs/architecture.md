# Blurry Site — High-Level Design

## 1. Overview

BlurrySite is a Manifest V3 browser extension targeting Chrome, Edge, and Firefox. It applies a CSS `filter: blur()` to DOM elements on demand. Users can blur entire pages with a keyboard shortcut or select individual elements with an interactive picker. Blur state is persisted per hostname and automatically restored on subsequent visits.

---

## 2. Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER CHROME                                                  │
│                                                                  │
│  ┌────────────┐   keyboard    ┌──────────────────────────────┐  │
│  │  Commands  │──────────────►│                              │  │
│  │  API       │               │     background.js            │  │
│  └────────────┘               │     (Service Worker)         │  │
│                               │                              │  │
│  ┌────────────┐  context menu │  ┌─────────────────────────┐ │  │
│  │  Context   │──────────────►│  │  chrome.storage.local   │ │  │
│  │  Menu API  │               │  │                         │ │  │
│  └────────────┘               │  │  blurred_items: {        │ │  │
│                               │  │    "hostname": [...]    │ │  │
│  ┌────────────┐  popup msgs   │  │  }                      │ │  │
│  │  Popup UI  │◄─────────────►│  │  settings: { ... }      │ │  │
│  │  (popup.js)│               │  └─────────────────────────┘ │  │
│  └────────────┘               │                              │  │
│                               └──────────────┬───────────────┘  │
│                                              │                   │
│                               sendMessage / onMessage            │
│                                              │                   │
│  ┌───────────────────────────────────────────▼───────────────┐  │
│  │  PAGE CONTEXT (injected into every tab)                   │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  content_script.js  (page orchestrator)             │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌──────────────┐  ┌───────────────┐                │  │  │
│  │  │  │ BlurEngine   │  │ SelectorUtils │                │  │  │
│  │  │  │ applyBlur()  │  │ getSelector() │                │  │  │
│  │  │  │ removeBlur() │  │ restoreAll()  │                │  │  │
│  │  │  └──────────────┘  └───────────────┘                │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌──────────────┐  ┌───────────────┐                │  │  │
│  │  │  │ Storage      │  │ Shortcuts     │                │  │  │
│  │  │  │ Manager      │  │ Handler       │                │  │  │
│  │  │  │ (→ bg.js)    │  │ held-key set  │                │  │  │
│  │  │  └──────────────┘  └───────────────┘                │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │  PrivacyBlurPicker                            │  │  │  │
│  │  │  │  Fixed toolbar + hover highlight + click-blur │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  styles/content.css  (injected alongside scripts)        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 background.js — Service Worker

The single persistent process in the extension. Responsible for:

- **Storage gateway** — all `chrome.storage.local` reads/writes. Content scripts never call storage directly; they send messages and receive responses.
- **Command relay** — translates manifest `Commands` API events (`Alt+Shift+B/P/U`) into typed messages sent to the active tab's content script.
- **Context menu** — registers "Blur this element" / "Unblur this element" right-click entries and relays clicks to the content script.
- **Restore trigger** — listens for `chrome.tabs.onUpdated` (status: "complete") and sends a `RESTORE` message so the content script re-applies persisted blur.

The service worker is stateless between wake cycles; all persistent data lives in `chrome.storage.local`.

### 3.2 content_script.js — Page Orchestrator

Injected into every page. Initialises on `DOMContentLoaded` (or immediately if the DOM is already ready). Owns the per-page state:

- `isPageBlurred` — whether blur-all mode is active
- `isPickerActive` — whether the element picker is open
- `settings` — current settings snapshot

Delegates to:
- `blsi.BlurEngine` for all DOM manipulation **and** blur-all lifecycle state (counters, MutationObserver, `isPageBlurred`)
- `blsi.Storage` for all persistent state (direct `chrome.storage.local` + reactive `onChange` subscription)
- `blsi.SelectorUtils` for selector generation
- `blsi.Shortcuts` for keyboard handling
- `blsi.Picker` for the interactive picker UI
- `blsi.UrlMatcher` for URL pattern matching + per-site settings resolution
- `blsi.Reveal` for click / hover / ancestor reveal state

### 3.3 blur_engine.js — Blur Core

Applies and removes blur from DOM elements. Handles three element categories differently:

| Category | Method |
|---|---|
| `<video>` | `<canvas>` overlay + `requestAnimationFrame` loop |
| `<img>` | `.bl-si-blurred` CSS class (CSS rule applies `blur(var(--bl-si-radius))`) |
| Everything else | `.bl-si-blurred` CSS class |

Exposes `applyBlur`, `removeBlur`, `toggleBlur`, `blurAllContent`, `unblurAll`, `isBlurred`, `invalidateSelectorCache`, `matchesActiveCategories`, `createZoneOverlay`, `removeZoneOverlay`, `getZoneOverlays`, `removeAllZoneOverlays`, `CATEGORY_SELECTORS`.

**Category-based blurring:** `blurAllContent` accepts an `options.categories` object to control which element groups are blurred. Five categories are supported: **text**, **media**, **form**, **table**, and **structure**. Selector strings for each category are cached internally and rebuilt only when the active categories change.

**Zone overlays (sticky blur):** The engine can create position-fixed overlay `<div>` elements that blur arbitrary rectangular regions of the viewport. Overlays are appended to `document.body`, identified by `data-bl-si-zone` attribute, and tracked internally. `unblurAll()` removes all zone overlays in addition to element-level blur. Zone overlay elements are excluded from blur targeting via `_isExtensionUI`.

### 3.4 selector_utils.js — Selector Generation

Generates and resolves CSS selectors for DOM elements so blur state can be saved and re-applied across page loads. Selector strategy:

1. Unique `id` attribute → `#escaped-id`
2. Existing `data-bl-si-id` or other stable data attributes → `[attr="value"]`
3. Fallback: stamp a random 8-hex UUID as `data-bl-si-id` → `[data-bl-si-id="..."]`

### 3.5 storage_manager.js — Storage Abstraction

A thin Promise-based wrapper around `chrome.runtime.sendMessage`. All methods delegate to background.js for the actual `chrome.storage.local` call. This design:

- Keeps storage logic in one place (background.js)
- Prevents content scripts from needing `storage` permission directly
- Makes the storage layer mockable in unit tests (mock `chrome.runtime.sendMessage`)

### 3.6 shortcut_handler.js — Keyboard Shortcut Matcher

Matches registered chords `{ code, mods }` against `KeyboardEvent`. Reads mod state from `event.altKey/ctrlKey/metaKey/shiftKey` (side-agnostic). First match fires the action callback and preventDefaults the event. Guards against `repeat`, `isComposing`, `Dead`, `Process`, `Unidentified`, `AltGraph`, and pure-modifier keydowns.

Action list is not hardcoded in this module — it reads from the action registry (see §3.6b) and uses `blsi.Actions.get(id).label` for the toast message.

Handles `Escape` to exit picker mode (only fires when `_isPickerActive` is set). On match, stamps `globalThis.__blsiShortcutFire[actionId]` with `performance.now()` — this is used by `content_script.handleMessage` to dedup the JS matcher path against `chrome.commands` relays from `background.js`.

### 3.6a action_registry.js — Action Registry

Single source of truth for every shortcut-driven action. Each entry carries `id`, `label`, `description`, `defaultBinding`, `messageType`, and `chromeCommand`. Consumers:
- `constants.buildDefaultSettings()` reads `defaultBindings()` lazily.
- `content_script.js` derives the shortcut-action handler map and dedup set from `Actions.list()`.
- `background.js` derives the `chrome.commands.onCommand` relay map from `Actions.list()`.
- `shortcut_handler.js` reads `Actions.get(id).label` for toast text.
- `popup/popup_configs.js` auto-generates the shortcut settings rows.
- The popup help overlay iterates `Actions.list()` for its content.

Adding a new shortcut-triggered action is one entry in `action_registry.js` plus a handler in `content_script.shortcutActionMap`.

### 3.6b shortcut_label.js — Platform-Aware Label Rendering

Central module that converts `{code, mods}` chords into human-readable labels. Mac renders Unicode glyphs (`⌘⇧⌥⌃`); Windows/Linux spells out modifiers. Also exports `chordKey()` / `bindingKey()` for canonical string forms used by conflict detection. Used by every UI surface that shows a shortcut (popup settings rows, capture modal preview, help overlay, toast via registry label).

### 3.6c shortcut_reserved.js — Browser-Reserved Chord Warnings

Minimal curated list (~12 entries) of browser shortcuts (`Ctrl+T`, `F12`, `Cmd+Q`, ...) that the popup's capture UI warns about. Per-platform filtering via `blsi.ShortcutLabel.IS_MAC`. Not a deny list — save is always allowed.

### 3.7 picker.js — Element Picker UI

A mode where the user can interactively select elements to blur. When active:

- Adds `bl-si-picker-active` to `<html>` (enables crosshair cursor via CSS)
- Injects a fixed toolbar at the top of the page
- Capture-phase `mouseover` / `mouseout` listeners add/remove `.bl-si-hover-highlight`
- Capture-phase `click` listener calls `onBlur` or `onUnblur` based on element state
- `Escape` or toolbar × button deactivates the picker

### 3.8 popup UI

HTML/CSS/JS popup opened via the browser action icon. Communicates exclusively via `chrome.runtime.sendMessage` (to background.js) and `chrome.tabs.sendMessage` (to the active tab's content script). Allows users to:

- Toggle the extension on/off
- View and remove individual blur items for the current page
- Adjust settings (blur radius, transitions, reveal mode, shortcut customization)
- Toggle blur categories, thorough blur mode
- Manage URL rules (per-site settings overrides)
- Clear all saved blur data

### 3.9 url_matcher.js — URL Pattern Matching

Pure module (no DOM, no storage). Exposes `blsi.UrlMatcher` with:

- `matchesPattern(url, pattern, patternType)` — wildcard mode parses scheme / hostname / port / path with domain-boundary awareness; regex mode rejects nested quantifiers (`(a+)+`, `a**`) to mitigate ReDoS.
- `resolveSettings(url, globalSettings, rules)` — deep-merge over `DEFAULT_SETTINGS`, apply the first matching rule's overrides. Tolerates non-array / null `rules`.

`MAX_PATTERN_LENGTH = 500`. Loaded at manifest position 2 (right after `constants.js`) so every downstream module can resolve per-URL settings without cycles.

### 3.10 reveal_controller.js — Click / Hover / Ancestor Reveal

Owns all reveal state extracted from `content_script.js`: click-revealed element, hover-revealed element, ancestor chain, mouseout debounce timer. Exposes `blsi.Reveal` with:

- `init({ getMode, isPickerActive })` — both are **functions**, read on every event. Caller never re-inits on settings change.
- `clearAll()` — resets every piece of reveal state. Called from `applyState` on `REVEAL_MODE` change and on `!settings.ENABLED`.
- `destroy()` — removes all document listeners + `clearAll()`.

Listeners are bubble-phase on `document` (click / keydown / mouseover / mouseout). Form-field targets (input / textarea / select / button / contenteditable) are skipped inside `onRevealClick`. Hover mode uses a 50ms mouseout debounce to avoid flicker across element boundaries.

---

## 4. Data Flow

### 4.1 Blur an element via picker

```
User clicks element
  → picker.js onClick (capture phase)
    → pickerCallbacks.onBlur(el)        [content_script.js]
      → PrivacyBlurEngine.applyBlur(el) [applies CSS filter]
      → PrivacyBlurSelectorUtils.getSelector(el) [generates selector]
      → PrivacyBlurStorage.saveBlurItem(host, blurItem)
          → chrome.runtime.sendMessage({ type: "SAVE_BLUR_ITEM", ... })
              → background.js SAVE_BLUR_ITEM handler
                  → chrome.storage.local.get + set
```

### 4.2 Restore blur on page load

```
chrome.tabs.onUpdated (status: "complete")
  → background.js sends { type: "RESTORE" } to tab
      → content_script.js handleMessage("RESTORE")
          → restoreBlurredElements()
              → PrivacyBlurStorage.getBlurItems(hostname)
                  → sendMessage GET_BLUR_ITEMS → background → storage
              → for each blur item:
                  → PrivacyBlurSelectorUtils.restoreSelector(s)
                  → PrivacyBlurEngine.applyBlur(el, radius)
```

### 4.3 Multi-key shortcut

```
User holds Alt (left)
  → shortcut_handler.js onKeyDown (capture phase)
    → adds "AltLeft" to heldKeys Set

User holds Shift (left) while Alt still held
  → adds "ShiftLeft" to heldKeys Set

User presses B while Alt+Shift still held
  → adds "KeyB" to heldKeys Set
  → checks each registered shortcut:
    → TOGGLE_BLUR_ALL: primaryModifier=AltLeft + keys=[ShiftLeft, KeyB]
    → all held? YES → preventDefault, fire callback
        → content_script.js handleMessage({ type: "TOGGLE_BLUR_ALL" })
            → PrivacyBlurEngine.blurAllContent(radius, options)
               or PrivacyBlurEngine.unblurAll()
        → showToast("BlurrySite: Blur All triggered")
```

### 4.4 Settings change from popup

```
User changes blur radius slider
  → popup.js sends UPDATE_SETTINGS to content script
      → content_script.js handleMessage("UPDATE_SETTINGS")
          → updates local settings object
          → document.documentElement.style.setProperty("--bl-si-radius", ...)
          → PrivacyBlurShortcuts.init(settings.SHORTCUTS, ...)
          → PrivacyBlurPicker.setSettings(newSettings)
  → popup.js also sends SAVE_SETTINGS to background
      → background.js SAVE_SETTINGS handler
          → chrome.storage.local.set({ settings: fullObject })
```

---

## 5. Storage Schema

```json
{
  "blurred_items": {
    "example.com": [{ "selector": "[data-bl-si-id=\"a3f92c1b\"]", "type": "picker" }, { "selector": "#main-header", "type": "picker" }],
    "news.ycombinator.com": [{ "selector": ".athing:nth-child(1) > .title", "type": "picker" }]
  },
  "settings": {
    "BLUR_RADIUS": 8,
    "TRANSITION_DURATION": 200,
    "HIGHLIGHT_COLOR": "#f59e0b",
    "REVEAL_MODE": "hover",
    "ENABLED": true,
    "THOROUGH_BLUR": false,
    "SHORTCUTS": {
      "TOGGLE_BLUR_ALL": { "primaryModifier": "AltLeft", "keys": [{ "key": "Shift", "code": "ShiftLeft" }, { "key": "b", "code": "KeyB" }] },
      "TOGGLE_PICKER":   { "primaryModifier": "AltLeft", "keys": [{ "key": "Shift", "code": "ShiftLeft" }, { "key": "p", "code": "KeyP" }] },
      "CLEAR_ALL":       { "primaryModifier": "AltLeft", "keys": [{ "key": "Shift", "code": "ShiftLeft" }, { "key": "u", "code": "KeyU" }] }
    },
    "BLUR_CATEGORIES": { "TEXT": true, "MEDIA": true, "FORM": false, "TABLE": true, "STRUCTURE": true }
  },
  "rules": [
    { "id": "abc123", "name": "Social media", "pattern": "*://twitter.com/*", "patternType": "wildcard", "settings": { "BLUR_RADIUS": 12, "THOROUGH_BLUR": true } }
  ],
  "blsi_debug": false
}
```

`blsi_debug` is the persistent toggle for `blsi.Logger` flow logging. Every context (background SW, content scripts, popup) reads it on load and observes `chrome.storage.onChanged` so a flip from any UI propagates to all live contexts without reload. See `LLD.md §8b`.

---

## 6. Message Protocol

All inter-component communication uses typed message objects.

### content_script ← background / popup

| Type | Payload | Description |
|------|---------|-------------|
| `TOGGLE_BLUR_ALL` | — | Toggle blur-all mode on the page |
| `TOGGLE_PICKER` | — | Toggle element picker |
| `CLEAR_ALL_BLUR` | — | Remove all blur, clear saved blur items for host |
| `RESTORE` | — | Re-apply persisted blur items |
| `GET_STATUS` | — | Returns `{ isPageBlurred, isPickerActive, blurredCount }` |
| `UPDATE_SETTINGS` | `{ settings }` | Apply new settings live |
| `CONTEXT_BLUR` | `{ elementSelector }` | Blur element by selector (context menu) |
| `CONTEXT_UNBLUR` | `{ elementSelector }` | Unblur element by selector (context menu) |
| `UNBLUR_ITEM` | `{ selector }` | Unblur a specific blur item (popup remove button) |
| `SCREEN_SHARE_NOTIFY` | — | Broadcast on screen-share state transitions. Toast ping; tabs re-resolve from `chrome.storage.session['blsi_screen_share']`. Replaces the legacy `SCREEN_SHARE_BLUR` / `SCREEN_SHARE_UNBLUR` per-tab fan-out. |

### content_script → background

| Type | Payload | Description |
|------|---------|-------------|
| `SCREEN_SHARE_STARTED` | — | `getDisplayMedia()` call succeeded in page. Background writes the global session record. |
| `SCREEN_SHARE_ENDED` | — | All display tracks ended. Background resets the record. |
| `WHO_AM_I` | — | Reply: `{ tab_id }`. Used by `screen_share.js` so content can self-identify for `Store.resolve(..., tab_id)` (sharing-tab self-skip + per-tab automate suppression). |

### storage_manager → background

| Type | Payload | Description |
|------|---------|-------------|
| `GET_BLUR_ITEMS` | `{ hostname }` | Fetch saved blur items for host |
| `SAVE_BLUR_ITEM` | `{ hostname, blurItem }` | Persist a new blur item |
| `REMOVE_BLUR_ITEM` | `{ hostname, selector }` | Remove a single blur item by selector |
| `CLEAR_HOST` | `{ hostname }` | Clear all blur items for host |
| `CLEAR_ALL` | — | Clear all blur items across all hosts |
| `GET_SETTINGS` | — | Fetch settings merged with defaults |
| `SAVE_SETTINGS` | `{ settings }` | Persist full settings object |
| `GET_RULES` | — | Fetch URL rules array |
| `SAVE_RULES` | `{ rules }` | Persist full URL rules array |

---

## 7. Security Considerations

- No `eval`, `Function()`, or `innerHTML` usage anywhere in the codebase.
- No inline scripts in HTML files (popup.js loaded via `<script src>`).
- Content scripts use `document.createElement` for all DOM construction.
- The extension requests only the minimum permissions: `storage`, `activeTab`, `scripting`, `contextMenus`.
- No external network requests are made from any extension component.
- CSS class and custom property names are `bl-si-` prefixed to minimise collision risk with page styles.
- The picker toolbar uses `all: initial` to prevent page CSS from breaking extension UI.
