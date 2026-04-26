# Blur Engine — Content Script Flow

`src/content_script.js` is the orchestrator that wires all modules together. It is not part of `blur_engine.js`, but it is the caller of every blur engine function that matters. This document covers the init sequence, settings flow, the `_sync()` convergence point, message routing, and iframe handling.

---

## Overview: Content Script Role

`content_script.js` is the thin orchestrator. Its responsibilities:
- Initialize all modules in the correct order
- Resolve settings from storage via `Store.resolve()`
- Call `Engine.handleSite(resolved)` on every state change
- Route messages from background.js and popup.js to the appropriate handlers
- Manage picker state atomically
- Handle SPA URL changes
- Bridge main frame to child iframes via postMessage

All per-element blur state, observer lifecycle, CSS management, and item tracking live in `blur_engine.js`. Content script does not track these — it only calls the engine.

---

## Module Aliases

At the top of the IIFE, module references are aliased:
```js
const Engine   = blsi.BlurEngine;
const Store    = blsi.Model;
const Selector = blsi.SelectorUtils;
const Picker   = blsi.Picker;
const Shortcuts = blsi.Shortcuts;
const Reveal   = blsi.Reveal;
```

These aliases are constants — never reassigned. All subsequent code uses the aliases.

---

## `init()` — 17-Phase Initialization

```
Phase 1:  Dispatch "bl-si-init-start" event (perf measurement start)
Phase 2:  await Store.init_cache()  (single storage read, populates in-memory cache)
Phase 3:  resolved = Store.resolve(_topHostname, location.href)
Phase 4:  await ContentI18n.init(language) [main frame only]
Phase 5:  applySettingsToDom(resolved)  (CSS custom properties on :root)
Phase 6:  _injectPwaPanel() [PWA mode only]
Phase 7:  chrome.runtime.onMessage.addListener(handleMessage)
Phase 8:  Reveal.init({ getMode, isPickerActive })
Phase 9:  document.addEventListener('contextmenu', captureTarget) [main frame only]
Phase 10: Early exit if disabled (subscribe to storage, dispatch ready, return)
Phase 11: Engine.resetCounters()
Phase 12: await applyState(resolved, null)
Phase 13: _checkPwaHint() [PWA mode only]
Phase 14: Store.on_change(handleStorageChange)  ← subscribed AFTER init
Phase 15: iframe cross-frame postMessage listener [iframes only]
Phase 16: _broadcastToFrames() [main frame only]
Phase 17: Dispatch "bl-si-ready" event (perf measurement end)
```

### Why Phase 14 (storage subscription) comes after Phase 12 (applyState)

If the storage subscription were registered *before* init's `applyState`, any cross-tab storage change (e.g., from another tab toggling blur-all) that arrives during init would fire `handleStorageChange`, which calls `_sync()`, which calls `Engine.handleSite()`. This would race with init's own `applyState()` → `_sync()`. The engine's mutex (`_handling`) would drop one of the calls. By subscribing after `applyState` completes, any changes that arrived during init are picked up on the next storage event (which always contains the latest state).

### Why Phase 11 (resetCounters) before Phase 12 (applyState)

`resetCounters()` zeros `_dynamicCounter` and `_stickyCounter`. The first `applyState()` call processes existing items from storage, which re-seeds the counters from item names. If `resetCounters` ran after `applyState`, the counters from a potential previous session's state (if the engine is reused) would not be zeroed.

### Phase 5: `applySettingsToDom(resolved)`

```js
function applySettingsToDom(resolved) {
  document.documentElement.style.setProperty('--bl-si-radius', resolved.blur_radius + 'px');
  document.documentElement.style.setProperty('--bl-si-highlight-color', resolved.highlight_color);
  document.documentElement.style.setProperty('--bl-si-transition-duration', resolved.transition_duration + 'ms');
  document.documentElement.style.setProperty('--bl-si-redaction-color', resolved.redaction_color);
}
```

Sets four CSS custom properties on `document.documentElement` (`:root`). These propagate to all CSS rules that reference them — including injected styles inside shadow roots (via CSS var inheritance).

Called at Phase 5 (before `applyState`) so that CSS vars are set before `injectRules()` runs inside `handleSite()`. The engine reads `--bl-si-radius` via `_readCssRadius()` when building the frosted SVG filter's `stdDeviation`.

Also called at the top of every subsequent `applyState()` call to keep CSS vars current on settings changes.

---

## `applyState(resolved, prev)` — Comprehensive State Application

Called by `init()`, `handleStorageChange()`, and `onUrlChange()`. Applies all settings to all modules:

```js
async function applyState(resolved, prev) {
  // 1. Update CSS vars
  applySettingsToDom(resolved);

  // 2. Shortcuts (re-init on binding changes)
  const shortcutsChanged = !prev || JSON.stringify(prev.shortcuts) !== JSON.stringify(resolved.shortcuts);
  if (shortcutsChanged) {
    Shortcuts.init(resolved.shortcuts, shortcutCallbacks);
  }

  // 3. Picker settings update (if active)
  if (isPickerActive) {
    Picker.setSettings(resolved.pick_and_blur.settings);
  }

  // 4. Reveal: clear on mode change or disable
  if (!prev || prev.reveal_mode !== resolved.reveal_mode || !resolved.enabled) {
    Reveal.clearAll();
  }

  // 5. Sync to engine (the main blur engine call)
  await _sync();

  // 6. AutoBlur (idle + tab-switch)
  const autoBlurSettings = resolved.automate.settings;
  if (autoBlurSettings.idle.enabled || autoBlurSettings.tab_switch.enabled) {
    AutoBlur.init({ onIdle, onActive, onTabSwitch });
  } else {
    AutoBlur.destroy();
  }

  // 7. ScreenShare
  if (resolved.automate.settings.screen_share.enabled) {
    ScreenShare.init();
  } else {
    ScreenShare.destroy();
  }

  // 8. PII Detection
  const piiTypes = { email: resolved.pii_email, numeric: resolved.pii_numeric };
  const piiEnabled = piiTypes.email || piiTypes.numeric;
  if (piiEnabled) {
    PiiDetector.scan(document.body, piiTypes);
    Engine.injectPiiRules(resolved.pii_mode, resolved.redaction_color);
    PiiDetector.observeMutations(document.body);
  } else {
    PiiDetector.stopObserving();
    PiiDetector.clear(document.body);
    Engine.removePiiRules();
  }
}
```

**Step 5 (`_sync()`) is awaited:** This is the critical engine call. Every `_sync()` must be awaited — fire-and-forget would allow concurrent `handleSite()` calls from storage change events to interleave with this one, potentially corrupting `_activeItems`.

---

## `_sync()` — The Convergence Point

All blur state changes funnel through `_sync()`:

```js
async function _sync() {
  const resolved = Store.resolve(_topHostname, location.href);
  await Engine.handleSite(resolved);
}
```

**Why re-resolve inside `_sync()`:** The caller has already resolved settings, but `_sync()` re-resolves anyway. This ensures that by the time `handleSite()` is called, the most recent storage state is used — even if a storage event fired between the caller's resolve and the `_sync()` call.

**The invariant:** Every state change follows this pattern:
```js
await Store.save_something(...);  // write to storage
await _sync();                    // resolve from storage, call engine
```

Never:
```js
await Store.save_something(...);
Engine.handleSite(partiallyBuiltSettings);  // wrong: stale or incomplete settings
```

---

## Message Routing: `handleMessage(message, sender, sendResponse)`

Registered at Phase 7. Routes all incoming messages:

```js
function handleMessage(message, _sender, sendResponse) {
  // Guard 1: Iframes reject all chrome.runtime messages
  if (!IS_MAIN_FRAME) {
    sendResponse({ ok: false, reason: 'iframe' });
    return;
  }

  // Guard 2: Fire-token dedup for shortcuts
  // (JS shortcut handler + chrome.commands both fire for same keystroke)
  if (isShortcutAction(message.type)) {
    const actionId = MESSAGE_TO_ACTION_ID[message.type];
    const lastFire = globalThis.__blsiShortcutFire?.[actionId];
    if (lastFire && Date.now() - lastFire < 500) {
      sendResponse({ ok: true, deduped: true });
      return;
    }
  }

  // Guard 3: Extension disabled — only allow status + panel toggle
  if (settings.enabled === false) {
    if (![MSG.GET_STATUS, MSG.TOGGLE_PANEL].includes(message.type)) {
      sendResponse({ ok: false, reason: 'disabled' });
      return;
    }
  }

  // Route by message type
  switch (message.type) {
    case MSG.TOGGLE_BLUR_ALL:    // async: storage write + _sync()
    case MSG.TOGGLE_PICKER:      // sync: picker activate/deactivate
    case MSG.GET_STATUS:         // sync: DOM query
    case MSG.CLEAR_ALL_BLUR:     // async
    case MSG.CONTEXT_BLUR:       // async
    case MSG.CONTEXT_UNBLUR:     // async
    case MSG.BLUR_SELECTION:     // sync: SelectionBlur.blurSelection()
    case MSG.TOGGLE_PANEL:       // sync: PWA panel toggle
    case MSG.SCREEN_SHARE_BLUR:  // async
    case MSG.SCREEN_SHARE_UNBLUR:// async
  }
}
```

**Async handlers return `true`:** Handlers that call `sendResponse` asynchronously must `return true` from `handleMessage` to keep the Chrome message port open. Forgetting `return true` causes `sendResponse` to silently fail.

### Fire-Token Dedup for Shortcuts

When the user presses a keyboard shortcut:
1. **JS shortcut handler** (`shortcut_handler.js`) fires synchronously → calls `shortcutCallbacks[actionId]()` → calls `handleMessage`
2. **`chrome.commands`** (manifest.json commands) fires asynchronously → background.js receives it → relays via `chrome.tabs.sendMessage` → calls `handleMessage`

Both paths arrive at `handleMessage` for the same action. Without dedup, the action fires twice.

The shortcut handler stamps a fire-token:
```js
globalThis.__blsiShortcutFire = globalThis.__blsiShortcutFire || {};
globalThis.__blsiShortcutFire[actionId] = Date.now();
```

`handleMessage` checks this token — if the same action was fired within the last 500ms via the JS path, the chrome.commands relay is dropped.

---

## `GET_STATUS` Response

```js
case MSG.GET_STATUS:
  sendResponse({
    isPageBlurred: Engine.isPageBlurred,
    isPickerActive,
    blurredCount: document.querySelectorAll('[data-bl-si-blur]').length,
  });
```

`blurredCount` counts only `[data-bl-si-blur]` stamped elements — it does not count always-blur tag elements (which are blurred by CSS without the attribute), picker items, or PII spans. This is a fast approximate count for popup display.

---

## `setPickerActive(active)` — Atomic Three-Way Update

```js
function setPickerActive(active) {
  isPickerActive = active;
  Shortcuts._setPickerActive(active);
  Engine._setPickerActiveForObserver(active);
}
```

This must always be called instead of updating any of the three values directly. The three pieces of state must stay in sync:
1. `isPickerActive` — content_script local state (passed to Reveal via closure function)
2. `Shortcuts._setPickerActive` — prevents shortcut handler from firing Escape as an action (Escape is picker-deactivate when picker is active)
3. `Engine._setPickerActiveForObserver` — gates the MutationObserver

**Callers that must use this helper:**
- `TOGGLE_PICKER` message handler (picker activate/deactivate)
- `pickerCallbacks.onDeactivate` (picker self-deactivation)
- `applyState()` when extension is disabled

---

## `handleStorageChange(newModel, oldModel)` — Reactive Updates

```js
async function handleStorageChange(newModel, _oldModel) {
  if (!Engine) return;

  const prev = { ...settings };
  const resolved = Store.resolve(_topHostname, location.href);

  // Language change: re-init i18n + rebuild picker toolbar if active
  if (IS_MAIN_FRAME && newModel.settings?.language !== settings.language) {
    await ContentI18n.init(newModel.settings.language);
    if (Picker.isActive) Picker.rebuildToolbar();
  }

  await applyState(resolved, prev);

  // Broadcast to child iframes
  if (IS_MAIN_FRAME) {
    _broadcastToFrames();
  }
}
```

Called on every `blsi_model` storage change (any tab can change it — popup, another content script, background).

**Language change special case:** Picker toolbar uses localized strings. If the toolbar is open when language changes, it must be rebuilt to show the new language.

**Broadcasting to iframes:** After the main frame updates, it broadcasts the new `_topHostname` to all child iframes so they can re-sync their blur state.

---

## `onUrlChange()` — SPA Navigation

SPAs change the URL without a full page reload. Content script must re-resolve settings when the URL changes:

```js
async function onUrlChange() {
  if (!Engine) return;
  if (location.href === lastUrl) return;
  lastUrl = location.href;

  const resolved = Store.resolve(_topHostname, location.href);
  const prev = { ...settings };
  await applyState(resolved, prev);
}
```

**Triggered by three events:**
1. `window.popstate` — browser back/forward navigation
2. `window.hashchange` — hash change (`#anchor`)
3. `history.pushState` override — SPA router pushes new URL

History method wrapping:
```js
const _origPushState = history.pushState.bind(history);
history.pushState = function(...args) {
  _origPushState(...args);
  onUrlChange();
};
// Same for replaceState
```

**Why override history methods:** SPAs that use `history.pushState()` directly (Next.js, React Router) do not fire `popstate`. Wrapping ensures `onUrlChange` fires after any navigation method.

---

## Main Frame vs. Iframe: Behavior Table

| Behavior | Main Frame | Iframe |
|---|---|---|
| Handles `chrome.runtime.onMessage` | YES | NO (rejects with `{ reason: 'iframe' }`) |
| Initializes shortcuts | YES | NO |
| Initializes picker | YES | NO |
| Tracks context menu target | YES | NO |
| Broadcasts to child iframes | YES | NO |
| Listens to parent postMessage | NO | YES |
| `_topHostname` source | `location.hostname` | Derived from `document.referrer`; updated via postMessage |
| `blur_all_active` lookup | `location.hostname` | `_topHostname` (parent's hostname) |
| SPA URL change tracking | YES | NO (iframes don't wrap history) |

**Why iframes follow parent's hostname:**
If the main page has blur-all active for `gmail.com`, embedded iframes should also blur. An iframe at `mail.google.com` (cross-origin) has its own `location.hostname` and would look up blur state for `mail.google.com` — which may have different settings. Using the parent's hostname (`gmail.com`) ensures all iframes on the page share the parent's blur state.

**How iframes learn the parent's hostname:**
Main frame broadcasts after every storage change:
```js
function _broadcastToFrames() {
  const frames = document.querySelectorAll('iframe');
  for (const frame of frames) {
    try {
      frame.contentWindow.postMessage({
        type: 'BLSI_SETTINGS_CHANGED',
        topHostname: location.hostname,
      }, '*');
    } catch (_) {}  // cross-origin frames may throw
  }
}
```

Iframes listen:
```js
window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.data?.type === 'BLSI_SETTINGS_CHANGED') {
    _topHostname = event.data.topHostname || _topHostname;
    _sync();
  }
});
```

---

## Picker Callback Wiring

Five callbacks passed to `Picker.activate()`:

```js
const pickerCallbacks = {
  onBlur: async (el) => {
    const selectors = Selector.getSelectors(el);
    if (!selectors.length) return;
    const name = Engine.allocateDynamicName();
    await Store.save_blur_item(hostname, { type: 'dynamic', name, selectors });
    await _sync();
  },

  onUnblur: async (el) => {
    const selectors = Selector.getSelectors(el);
    if (!selectors.length) return;
    await Store.remove_blur_item(hostname, selectors[0]);
    await _sync();
  },

  onStickyBlur: async (zoneRect) => {
    const name = Engine.allocateStickyName();
    const item = _buildStickyItem(name, zoneRect);
    await Store.save_blur_item(hostname, item);
    await _sync();
    Shortcuts.showToast(name);
  },

  onStickyUnblur: async (zoneId) => {
    await Store.remove_blur_item(hostname, zoneId);
    await _sync();
  },

  onDeactivate: () => {
    setPickerActive(false);  // atomic three-way update
  },

  onModeChange: (mode) => {
    Store.patch_section('pick_and_blur', { settings: { picker_mode: mode } });
    // note: no _sync() — mode change doesn't affect current session blur state
  },
};
```

Every blur-state callback:
1. Writes to storage
2. Awaits `_sync()` — re-resolves from storage, calls engine

`onModeChange` does NOT call `_sync()` — picker mode changes only affect future sessions. The current session's picker continues in the mode it was started with.

---

## Settings Flow Summary

```
chrome.storage.local { blsi_model }
        │
        ▼ (once on init)
Store.init_cache()
        │
        ▼ (on every state change)
Store.resolve(_topHostname, url)
        │
        ├─ merges: global settings + site_rules + blur_all state + blur_items
        │
        ▼
applyState(resolved, prev)
        │
        ├── applySettingsToDom(resolved)  [CSS vars on :root]
        ├── Shortcuts.init(shortcuts)     [keyboard shortcuts]
        ├── Picker.setSettings(...)       [if picker active]
        ├── Reveal.clearAll()             [if mode changed]
        │
        ├── _sync()
        │       └── Engine.handleSite(resolved)
        │               ├── Phase 1: _currentSettings = resolved
        │               ├── Phase 2: disabled? → teardown
        │               ├── Phase 3: reconcileKey? → handleMainDocument()
        │               └── Phase 4: _reconcileItems(blur_items)
        │
        ├── AutoBlur.init/destroy
        ├── ScreenShare.init/destroy
        └── PiiDetector.scan/clear + Engine.injectPiiRules/removePiiRules
```

Every path — init, user toggle, popup setting change, SPA navigation, cross-tab sync — produces exactly this sequence. The engine always receives the full resolved settings snapshot; it never reads storage directly.
