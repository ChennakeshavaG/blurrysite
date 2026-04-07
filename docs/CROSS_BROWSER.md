# PrivacyBlur — Cross-Browser Compatibility

## Summary

PrivacyBlur targets Manifest V3 (MV3) on both Chrome/Edge and Firefox 109+. The extension is architecturally browser-agnostic: it uses the `chrome.*` API namespace throughout, which Firefox exposes as a compatibility shim since Firefox 109 (alongside its native `browser.*` namespace).

---

## 1. Manifest

### What is shared

Every manifest key in this extension works identically in Chrome and Firefox:

| Key | Chrome | Firefox |
|-----|--------|---------|
| `manifest_version: 3` | ✓ Chrome 88+ | ✓ Firefox 109+ |
| `permissions` (storage, activeTab, scripting, contextMenus) | ✓ | ✓ |
| `host_permissions` | ✓ | ✓ |
| `background.service_worker` | ✓ | ✓ Firefox 109+ |
| `content_scripts` | ✓ | ✓ |
| `commands` | ✓ | ✓ |
| `action` | ✓ | ✓ |
| `web_accessible_resources` | ✓ | ✓ |

### Firefox-only section

```json
"browser_specific_settings": {
  "gecko": {
    "id": "privacyblur@extension",
    "strict_min_version": "109.0"
  }
}
```

- `id` — required for Firefox signing and `about:debugging` identification. Ignored by Chrome.
- `strict_min_version: "109.0"` — enforces that Firefox MV3 support is present before loading. Ignored by Chrome.

---

## 2. API Compatibility

### chrome.* namespace

Firefox 109+ provides the `chrome.*` namespace as a wrapper over its native `browser.*` API. The wrapper is maintained by Mozilla and covers all APIs used by this extension.

| chrome.* call | Chrome | Firefox (chrome.*) | Notes |
|---|---|---|---|
| `chrome.runtime.sendMessage` | ✓ | ✓ | Identical behaviour |
| `chrome.runtime.onMessage.addListener` | ✓ | ✓ | Return `true` for async response — required in both |
| `chrome.runtime.onInstalled.addListener` | ✓ | ✓ | |
| `chrome.runtime.onStartup.addListener` | ✓ | ✓ | |
| `chrome.runtime.lastError` | ✓ | ✓ | |
| `chrome.storage.local.get/set/remove` | ✓ | ✓ | |
| `chrome.tabs.query` | ✓ | ✓ | |
| `chrome.tabs.sendMessage` | ✓ | ✓ | |
| `chrome.tabs.onUpdated.addListener` | ✓ | ✓ | |
| `chrome.commands.onCommand.addListener` | ✓ | ✓ | |
| `chrome.contextMenus.*` | ✓ | ✓ | Identical API surface |
| `chrome.action.setTitle` / `setBadgeText` | ✓ | ✓ Firefox 109+ | |
| `chrome.scripting.*` | ✓ | ✓ Firefox 102+ | |

### Service worker vs background page

| Feature | Chrome | Firefox |
|---|---|---|
| Service worker (MV3) | ✓ | ✓ Firefox 109+ |
| Background page (MV2) | MV2 only | MV2 only |
| Worker can call `chrome.storage` | ✓ | ✓ |
| Worker can call `chrome.tabs` | ✓ | ✓ |

**Note:** Service workers in Firefox 109–115 had intermittent lifecycle issues where the worker could be terminated more aggressively than in Chrome. Any state that must survive across message cycles should be in `chrome.storage.local`, not in module-level variables. PrivacyBlur's `background.js` is already stateless by design — all persistent state is in storage.

---

## 3. Content Script Behaviour

| Feature | Chrome | Firefox |
|---|---|---|
| `document_idle` run_at | ✓ | ✓ |
| `all_frames: false` | ✓ | ✓ |
| `capture: true` event listeners | ✓ | ✓ |
| `MutationObserver` | ✓ | ✓ |
| `CSS.escape()` | ✓ | ✓ Firefox 31+ |
| `crypto.getRandomValues()` | ✓ | ✓ |
| `WeakMap` | ✓ | ✓ |
| `requestAnimationFrame` | ✓ | ✓ |
| `canvas.getContext("2d")` | ✓ | ✓ |
| `ctx.filter` (canvas 2D filter) | ✓ Chrome 52+ | ✓ Firefox 49+ |
| CSS `filter: blur()` | ✓ | ✓ |
| CSS `will-change` | ✓ | ✓ Firefox 36+ |
| CSS custom properties | ✓ Chrome 49+ | ✓ Firefox 31+ |
| `color-mix()` CSS function | ✓ Chrome 111+ | ✓ Firefox 113+ |

### CSS fallbacks in content.css

The stylesheet provides fallbacks for `color-mix()`:
```css
/* Fallback for Chrome < 111, Firefox < 113 */
box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25), ...;
/* Preferred with color-mix() */
box-shadow: 0 0 0 4px color-mix(in srgb, var(--pb-highlight-color, #f59e0b) 25%, transparent), ...;
```

`-webkit-filter` prefixes are included alongside `filter` for Safari (though Safari is not a primary target).

---

## 4. Keyboard Shortcuts

### Commands API (Alt+Shift+B / P / U)

Both browsers support the `commands` API. However, default shortcut assignments differ:

| Key | Chrome | Firefox |
|---|---|---|
| `Alt+Shift+*` | ✓ All OS | ✓ All OS |
| Reassignment | `chrome://extensions/shortcuts` | `about:addons` → extension cog → Manage Extension Shortcuts |

### Multi-key simultaneous shortcuts

Implemented entirely in `shortcut_handler.js` via `keydown`/`keyup` event listeners — no browser API used. Works identically in both browsers. The handler tracks held keys via a `Set<code>` and fires when all required keys for a shortcut are held simultaneously.

**Default shortcuts:** Alt+Shift+B (toggle blur all), Alt+Shift+P (toggle picker), Alt+Shift+U (clear all blur). These match the `commands` entries in `manifest.json`.

**Ctrl+K conflicts are no longer relevant** since the default shortcuts use Alt+Shift, which does not conflict with browser address bar shortcuts on any platform.

---

## 5. Known Firefox-Specific Differences

### 5.1 context menu on all frames

Firefox may fire `contextMenus.onClicked` with a `frameId` property in `info`. The current handler ignores `frameId` — blur is always sent to the main frame via `chrome.tabs.sendMessage(tab.id, ...)`. This is consistent with the `all_frames: false` content script policy.

### 5.2 Canvas DRM restrictions

Both Chrome and Firefox prevent `ctx.drawImage()` from reading frames of DRM-encrypted `<video>` elements. PrivacyBlur handles this with a try-catch that falls back to a dark fill rectangle:

```javascript
try {
  ctx.drawImage(videoElement, 0, 0, w, h);
} catch {
  ctx.fillStyle = "rgba(30, 30, 30, 0.85)";
  ctx.fillRect(0, 0, w, h);
}
```

### 5.3 `position: fixed` in blurred containers

CSS `filter` creates a new stacking context. In both Chrome and Firefox, `position: fixed` children of a blurred element will be positioned relative to the blurred container rather than the viewport. This is a CSS specification behaviour, not a browser bug. Users should blur children of such containers individually using the picker.

### 5.4 `about:` and internal pages

Content scripts cannot run on `about:blank`, `about:newtab`, `chrome://`, `moz-extension://`, or other privileged pages. `background.js` already filters these:

```javascript
if (
  tab.url.startsWith("chrome://") ||
  tab.url.startsWith("chrome-extension://") ||
  tab.url.startsWith("about:") ||
  tab.url.startsWith("moz-extension://")
) return;
```

---

## 6. Extensibility Assessment

### Strengths

| Area | Assessment |
|---|---|
| **Module separation** | Each module is a self-contained IIFE with a clear single responsibility. Adding a new feature (e.g., a whitelist/blacklist mode) means adding a new module without modifying existing ones. |
| **Message protocol** | All inter-component communication is via typed string messages. New message types can be added to background.js and content_script.js without breaking existing handlers. |
| **Storage schema** | The `blurred_items` map is open-ended — any hostname can have typed blur items (dynamic selectors + sticky zones, max 10 per host). The `settings` object supports `deepMerge` so new settings keys can be added to `DEFAULT_SETTINGS` and they will be automatically backfilled for existing users. |
| **CSS custom properties** | `--pb-radius`, `--pb-highlight-color`, and `--pb-transition-duration` are set on `:root` by content_script. Any new CSS rules in `content.css` can consume these without touching JavaScript. |
| **Blur engine dispatch** | The element-type dispatch in `applyBlur` (video / img / background-image / generic) is an explicit if-chain that is easy to extend with new element types (e.g., `<canvas>`, `<iframe>`) without refactoring existing paths. |
| **No build step** | Vanilla JS with no bundler means zero toolchain debt. New files are added to manifest.json's `content_scripts.js` array and they work immediately. |

### Gaps and Recommended Improvements

#### 6.1 `browser.*` polyfill for future-proofing

The `chrome.*` compatibility shim in Firefox is maintained by Mozilla but is not guaranteed indefinitely. Adding the standard `webextension-polyfill` library makes the codebase forward-compatible with Firefox's native `browser.*` (Promise-based) API:

```json
// manifest.json — add before other content scripts
"js": [
  "vendor/browser-polyfill.min.js",
  "src/selector_utils.js",
  ...
]
```

The polyfill is a drop-in; no code changes are needed since all current calls use `chrome.*`.

#### 6.2 Settings versioning

There is currently no migration path for settings schema changes. If a new required key is added to `DEFAULT_SETTINGS`, existing users will get the default value on next read (correct), but stored partial objects will not be cleaned up. Add a `settingsVersion` integer to the schema and run a one-time migration in `chrome.runtime.onInstalled` when version bumps.

#### 6.3 Selector staleness on SPAs

The current selector strategy (ID → `data-pb-id`) works well for static pages but can produce stale selectors on React/Vue/Angular apps that re-render elements. Options to improve:

- Add a `data-testid` / `data-cy` priority tier before stamping `data-pb-id` (already present in `UNIQUE_DATA_ATTRS` but not active since nth-child was removed).
- Store both the selector AND a content fingerprint (e.g., trimmed text content, first 32 chars) so the restore logic can fuzzy-match when the selector misses.

#### 6.4 Cross-frame blur

The extension only injects into the top frame (`all_frames: false`). For same-origin iframes, switching to `all_frames: true` and coordinating via `window.frameElement` would allow blurring content inside iframes. Cross-origin frames are permanently restricted by browser security.

#### 6.5 Per-site enable/disable

There is currently no mechanism to disable the extension for a specific hostname without going to the popup. A `disabled_hosts` array in settings plus a guard at the top of `init()` would add this.

#### 6.6 Context menu element targeting

The `CONTEXT_BLUR` / `CONTEXT_UNBLUR` messages include `elementSelector` in the payload, but `background.js` does not currently capture which element was right-clicked (the `info.targetElementId` from the contextMenus API). This path is incomplete — context menu blur currently has no reliable way to identify the specific right-clicked element. Implementing it fully requires capturing the `targetElementId` from `contextMenus.onClicked` and using `chrome.dom.getDetailsForPromise` or the `frameId`-based approach.

#### 6.7 No `_setPickerActive` notification path from picker.js escape

When the user presses `Escape` inside `picker.js`, the picker calls `deactivate()` which calls `pickerCallbacks.onDeactivate()`. The `onDeactivate` callback in `content_script.js` correctly calls `Shortcuts._setPickerActive(false)`, so the shortcut handler is updated. This flow is correct but fragile — if a future developer adds another deactivation path in `picker.js` that does not go through `onDeactivate`, the shortcut handler will have stale state. Consider moving `_isPickerActive` entirely to `content_script.js` and removing it from `shortcut_handler.js`.

---

## 7. Browser Compatibility Matrix

| Feature | Chrome 88+ | Edge 88+ | Firefox 109+ | Safari |
|---|---|---|---|---|
| Manifest V3 | ✓ | ✓ | ✓ | Partial (MV3 support incomplete) |
| `chrome.*` namespace | Native | Native | Compatibility shim | Partial |
| Service worker background | ✓ | ✓ | ✓ | ✓ (limited) |
| CSS `filter: blur()` | ✓ | ✓ | ✓ | ✓ (-webkit-) |
| Canvas 2D `ctx.filter` | ✓ | ✓ | ✓ | ✓ |
| `requestAnimationFrame` | ✓ | ✓ | ✓ | ✓ |
| CSS custom properties | ✓ | ✓ | ✓ | ✓ |
| Multi-key shortcut (JS) | ✓ | ✓ | ✓ | N/A (no extension support) |
| Context menus API | ✓ | ✓ | ✓ | ✗ |
| `color-mix()` CSS | Chrome 111+ | Edge 111+ | Firefox 113+ | Safari 16.2+ |
| `all_frames: true` (future) | ✓ | ✓ | ✓ | N/A |

**Safari:** Safari's WebExtension support (Safari 14+) uses a different toolchain (`xcrun safari-web-extension-converter`) and has incomplete MV3 support. PrivacyBlur does not currently target Safari and would require non-trivial changes to run there.
