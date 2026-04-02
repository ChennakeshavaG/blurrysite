# PrivacyBlur — High-Level Design

## 1. Overview

PrivacyBlur is a Manifest V3 browser extension targeting Chrome, Edge, and Firefox. It applies a CSS `filter: blur()` to DOM elements on demand. Users can blur entire pages with a keyboard shortcut or select individual elements with an interactive picker. Blur state is persisted per hostname and automatically restored on subsequent visits.

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
│  └────────────┘               │  │  blurred_selectors: {   │ │  │
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
│  │  │  │ (→ bg.js)    │  │ chord / Esc   │                │  │  │
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
- `PrivacyBlurEngine` for all DOM manipulation
- `PrivacyBlurStorage` for all persistent state (which proxies to background.js)
- `PrivacyBlurSelectorUtils` for selector generation
- `PrivacyBlurShortcuts` for keyboard handling
- `PrivacyBlurPicker` for the interactive picker UI

### 3.3 blur_engine.js — Blur Core

Applies and removes blur from DOM elements. Handles three element categories differently:

| Category | Method |
|---|---|
| `<video>` | `<canvas>` overlay + `requestAnimationFrame` loop |
| `<img>` | `style.filter = blur(Xpx)` directly on the element |
| Everything else | `.pb-blurred` CSS class + `--pb-radius` custom property |

Exposes `applyBlur`, `removeBlur`, `toggleBlur`, `blurAllContent`, `unblurAll`, `isBlurred`.

### 3.4 selector_utils.js — Selector Generation

Generates and resolves CSS selectors for DOM elements so blur state can be saved and re-applied across page loads. Selector strategy:

1. Unique `id` attribute → `#escaped-id`
2. Existing `data-pb-id` or other stable data attributes → `[attr="value"]`
3. Fallback: stamp a random 8-hex UUID as `data-pb-id` → `[data-pb-id="..."]`

### 3.5 storage_manager.js — Storage Abstraction

A thin Promise-based wrapper around `chrome.runtime.sendMessage`. All methods delegate to background.js for the actual `chrome.storage.local` call. This design:

- Keeps storage logic in one place (background.js)
- Prevents content scripts from needing `storage` permission directly
- Makes the storage layer mockable in unit tests (mock `chrome.runtime.sendMessage`)

### 3.6 shortcut_handler.js — Keyboard Chord

Detects a two-key chord sequence that the `Commands` API cannot express:

1. User presses `[modifier]+[key1]` (default: `Ctrl+K`) → `preventDefault`, enter "awaiting second key" state
2. Within 1000 ms, user presses `[key2]` (default: `V`) with no modifier → fire `TOGGLE_BLUR_ALL`
3. Any other key or timeout → reset state silently

Also handles `Escape` to exit picker mode (only fires when `_isPickerActive` is set).

### 3.7 picker.js — Element Picker UI

A mode where the user can interactively select elements to blur. When active:

- Adds `pb-picker-active` to `<html>` (enables crosshair cursor via CSS)
- Injects a fixed toolbar at the top of the page
- Capture-phase `mouseover` / `mouseout` listeners add/remove `.pb-hover-highlight`
- Capture-phase `click` listener calls `onBlur` or `onUnblur` based on element state
- `Escape` or toolbar × button deactivates the picker

### 3.8 popup UI

HTML/CSS/JS popup opened via the browser action icon. Communicates exclusively via `chrome.runtime.sendMessage` (to background.js) and `chrome.tabs.sendMessage` (to the active tab's content script). Allows users to:

- Toggle the extension on/off
- View and remove individual blurred selectors for the current page
- Adjust settings (blur radius, transitions, reveal-on-hover, chord keys)
- Clear all saved blur data

---

## 4. Data Flow

### 4.1 Blur an element via picker

```
User clicks element
  → picker.js onClick (capture phase)
    → pickerCallbacks.onBlur(el)        [content_script.js]
      → PrivacyBlurEngine.applyBlur(el) [applies CSS filter]
      → PrivacyBlurSelectorUtils.getSelector(el) [generates selector]
      → PrivacyBlurStorage.saveBlurredElement(host, selector)
          → chrome.runtime.sendMessage({ type: "SAVE_SELECTOR", ... })
              → background.js SAVE_SELECTOR handler
                  → chrome.storage.local.get + set
```

### 4.2 Restore blur on page load

```
chrome.tabs.onUpdated (status: "complete")
  → background.js sends { type: "RESTORE" } to tab
      → content_script.js handleMessage("RESTORE")
          → restoreBlurredElements()
              → PrivacyBlurStorage.getBlurredSelectors(hostname)
                  → sendMessage GET_SELECTORS → background → storage
              → for each selector:
                  → PrivacyBlurSelectorUtils.restoreSelector(s)
                  → PrivacyBlurEngine.applyBlur(el, radius)
```

### 4.3 Chord shortcut

```
User presses Ctrl+K
  → shortcut_handler.js onKeyDown (capture phase)
    → records chord state + starts 1s timeout

User presses V (within 1s, no modifier)
  → shortcut_handler.js onKeyDown
    → fires shortcutActionMap.TOGGLE_BLUR_ALL()
        → content_script.js handleMessage({ type: "TOGGLE_BLUR_ALL" })
            → PrivacyBlurEngine.blurAllContent(radius)
               or PrivacyBlurEngine.unblurAll()
```

### 4.4 Settings change from popup

```
User changes blur radius slider
  → popup.js sends UPDATE_SETTINGS to content script
      → content_script.js handleMessage("UPDATE_SETTINGS")
          → updates local settings object
          → document.documentElement.style.setProperty("--pb-radius", ...)
          → PrivacyBlurShortcuts.init(newSettings, ...)
          → PrivacyBlurPicker.setSettings(newSettings)
  → popup.js also sends SAVE_SETTINGS to background
      → background.js SAVE_SETTINGS handler
          → chrome.storage.local.set({ settings: merged })
```

---

## 5. Storage Schema

```json
{
  "blurred_selectors": {
    "example.com": ["[data-pb-id=\"a3f92c1b\"]", "#main-header"],
    "news.ycombinator.com": [".athing:nth-child(1) > .title"]
  },
  "settings": {
    "blurRadius": 8,
    "blurTransition": true,
    "pickerHighlightColor": "#f59e0b",
    "enabled": true,
    "shortcuts": {
      "chordKey1": "k",
      "chordKey2": "v",
      "chordModifier": "ctrl"
    }
  }
}
```

---

## 6. Message Protocol

All inter-component communication uses typed message objects.

### content_script ← background / popup

| Type | Payload | Description |
|------|---------|-------------|
| `TOGGLE_BLUR_ALL` | — | Toggle blur-all mode on the page |
| `TOGGLE_PICKER` | — | Toggle element picker |
| `CLEAR_ALL_BLUR` | — | Remove all blur, clear saved selectors for host |
| `RESTORE` | — | Re-apply persisted selectors |
| `GET_STATUS` | — | Returns `{ isPageBlurred, isPickerActive, blurredCount }` |
| `UPDATE_SETTINGS` | `{ settings }` | Apply new settings live |
| `CONTEXT_BLUR` | `{ elementSelector }` | Blur element by selector (context menu) |
| `CONTEXT_UNBLUR` | `{ elementSelector }` | Unblur element by selector (context menu) |

### storage_manager → background

| Type | Payload | Description |
|------|---------|-------------|
| `GET_SELECTORS` | `{ hostname }` | Fetch saved selectors for host |
| `SAVE_SELECTOR` | `{ hostname, selector }` | Persist a new selector |
| `REMOVE_SELECTOR` | `{ hostname, selector }` | Remove a single selector |
| `CLEAR_HOST` | `{ hostname }` | Clear all selectors for host |
| `CLEAR_ALL` | — | Clear all selectors across all hosts |
| `GET_SETTINGS` | — | Fetch settings merged with defaults |
| `SAVE_SETTINGS` | `{ settings }` | Persist partial settings update |

---

## 7. Security Considerations

- No `eval`, `Function()`, or `innerHTML` usage anywhere in the codebase.
- No inline scripts in HTML files (popup.js loaded via `<script src>`).
- Content scripts use `document.createElement` for all DOM construction.
- The extension requests only the minimum permissions: `storage`, `activeTab`, `scripting`, `contextMenus`.
- No external network requests are made from any extension component.
- CSS class and custom property names are `pb-` prefixed to minimise collision risk with page styles.
- The picker toolbar uses `all: initial` to prevent page CSS from breaking extension UI.
