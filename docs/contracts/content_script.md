# content_script Contract

> **Post-engine/automate-split notes (current state):**
> - `_sync()`, `handleStorageChange`, `onUrlChange`, `init`, and `TOGGLE_PICKER` call **`Store.resolve_settings(...)`** (engine surface — no automate decision fields). Older paragraphs in this contract that say `Store.resolve()` should be read as `Store.resolve_settings()` unless explicitly noted otherwise. The bootstrap screen-share catch-up toast (step 9b) calls `Store.resolve_automate(...)` directly for its slim snapshot.
> - `blsi.Automate.Manager` owns automate Overlay show/hide AND the three automate transition toasts (idle / tab_switch / screen_share). The previous content_script-level toast attribution and the `_ssCurrentlyBlurring` / `_lastIdlePhase` / `_lastTabSwitchPhase` module-level fields have been removed.
> - All in-page toast rendering goes through `blsi.Toast.show` (see `docs/contracts/toast.md`). content_script never reaches into `blsi.Shortcuts` for toast surface.
> - `TOGGLE_BLUR_ALL` reads `blur_all.status` from `Store.get()` directly rather than deriving from `Engine.isPageBlurred` (the latter only reflects engine-driven blur post-split).

## Overview

`content_script.js` is the top-level orchestrator injected into every page (all frames, `run_at: document_idle`). It has no IIFE global of its own — it coordinates all `blsi.*` modules that were loaded before it by `manifest.json`. It owns the lifecycle: initialization, storage subscriptions, message routing, picker callbacks, shortcut dispatch, SPA URL change detection, and cross-frame postMessage protocol.

- Not an IIFE with a return value. One immediately-invoked arrow function, no export.
- Depends on: `blsi.Engine`, `blsi.Model`, `blsi.SelectorUtils`, `blsi.Picker`, `blsi.Shortcuts`, `blsi.Reveal`, `blsi.Logger`, `blsi.Screenshot`, `blsi.SelectionBlur`, `blsi.Automate.{State,Overlay,Visibility,Manager}`, `blsi.ScreenShare`, `blsi.PiiDetector`, `blsi.TabPrivacy`, `blsi.ContentI18n`, `blsi.Actions`.
- All of the above are available synchronously because `manifest.json` load order guarantees them before this file.

---

## Initialization Sequence

`init()` is called once, either immediately (if `document.readyState !== 'loading'`) or on `DOMContentLoaded`. Steps in order:

1. Dispatch `'bl-si-init-start'` CustomEvent on `document` (anchors perf-test timers).
2. `blsi.Fonts.loadFonts()` — fire-and-forget. Registers the censored / starred WOFF2 fonts in `document.fonts` via the FontFace API so `font-family` rules render correctly even when page CSP forbids `chrome-extension://` in `font-src`. Idempotent.
3. `Store.init_cache()` — loads `blsi_model` from local storage and the screen-share + suppressed-tabs session keys into in-memory caches. Idle + tab_switch session caches live in `blsi.Automate.State` and self-hydrate. Concurrently fires `blsi.ScreenShare.whoAmI()` so the resolve below can identify the sharing tab on initial load.
4. `Store.resolve(_topHostname, location.href, _myTabId)` — resolves effective settings for the current URL + tab from the cache.
5. `blsi.ContentI18n.init(resolved.language)` — initializes i18n strings (main frame only).
6. If `IS_PWA`: call `_injectPwaPanel()`, store result in `_pwaPanelHost`.
7. `chrome.runtime.onMessage.addListener(handleMessage)` — registers the message handler.
8. `Reveal.init(...)` — registers reveal event listeners unconditionally (they early-return when disabled, but must be registered before enable/disable cycles).
9. Register `contextmenu` listener to track `lastContextMenuTarget` (main frame only).
10. If `resolved.enabled === false`: subscribe `Store.on_change(handleStorageChange)` and dispatch `'bl-si-ready'`; return early.
11. `Engine.resetCounters()` — clears dynamic/sticky name counters before applying stored items.
12. `Automate.Overlay.init()` (main frame only, idempotent) — readies the viewport overlay primitive used by automate intent. Mounts only on first `show()`.
13. `applyState(resolved, null)` — applies full settings: shortcuts, picker, tab privacy, reveal, engine sync, automate observers (`Automate.Visibility.init({tab_id})` / `ScreenShare.init`), PII scan.
13. Automate catch-up: if the resolved snapshot already carries an active automate trigger (screen_share > idle > tab_switch priority), shows the appropriate toast — screen-share = persistent + 3 stop-share actions; idle = persistent info-only (no actions); tab-switch = 3s info notification (no actions). No separate session-storage read; `Store.resolve_automate()` already factors in the per-tab session map.
14. `_checkPwaHint()` — shows one-time PWA tip (IS_PWA only).
15. `Store.on_change(handleStorageChange)` — subscribes to storage changes AFTER initial restore to avoid cold-start race conditions.
16. If not main frame: register `window.message` listener to receive `BLSI_SETTINGS_CHANGED` from parent frame.
17. If main frame: `_broadcastToFrames()` — send `topHostname` to all child iframes.
18. Dispatch `'bl-si-ready'` CustomEvent on `document`.

---

## Module-Level State

| Variable | Type | Description |
|---|---|---|
| `hostname` | `string` | `location.hostname` — immutable, used as storage key for blur items |
| `IS_MAIN_FRAME` | `boolean` | `window === window.top`; false inside any iframe |
| `IS_PWA` | `boolean` | True when running as installed PWA (standalone display mode), main frame only |
| `settings` | `object` | Last resolved settings snapshot (snake_case keys). Updated by every `_sync()` call |
| `isPickerActive` | `boolean` | Whether picker is currently active; single source of truth via `setPickerActive()` |
| `lastContextMenuTarget` | `Element\|null` | Last right-clicked element; set by `contextmenu` listener, consumed and cleared by `CONTEXT_BLUR`/`CONTEXT_UNBLUR` handlers |
| `_pwaPanelHost` | `Element\|null` | Shadow DOM host for the in-page settings panel (PWA only) |
| `_urlChangeTimer` | `number\|null` | Debounce timer id for SPA URL-change detection |
| `_topHostname` | `string` | Top-level page hostname used for blur_all lookup. Equals `location.hostname` in main frame; derived from `document.referrer` in iframes. Updated via postMessage. |
| `lastUrl` | `string` | Last observed `location.href` for SPA navigation change detection |

> Removed in the engine/automate split: `_ssCurrentlyBlurring`, `_lastIdlePhase`, `_lastTabSwitchPhase`, `_autoBlurCfgKey`, `_idleToastShown`. Toast tracking now lives in `blsi.Automate.Manager`.

### Automate toast action builders (private)

Only screen-share carries action buttons in-page. `_ssBlurStopActions()` returns `[{label, onClick, variant?, tooltip?}]` with the 3 actions: "Skip tab", "Skip site", "Turn off" (i18n keys `automate_stop_per_tab`, `automate_stop_site_session`, `automate_disable_feature`; tooltips `automate_tooltip_skip_*`). Each `onClick` calls `Store.suppress_screen_share(scope, ctx)` then `await _sync()`. Manager calls the builder async at toast-fire time so each invocation captures the *current* `_topHostname` / `_initTabId` closure.

`_ssResumeAction()` (synchronous) returns `[{label, onClick}]` with a single "Undo" button (i18n key `notif_suppressed_undo`). `onClick` calls `Store.unsuppress_screen_share('feature', ctx)` then `await _sync()`. Must be synchronous — Manager calls it inline within `_fire_toasts` so the undo toast is created before `_seed_tracking` clobbers `_last_ss_blurring`. Manager calls this when the screen-share trigger is suspended while the share is still live, showing a transient 8s toast so the user can resume without opening the popup.

`_idleStopActions` and `_tabSwitchStopActions` were removed in the toast-redesign — idle is a persistent info-only toast (no buttons), tab-switch is a 3s info notification (no buttons). Per-trigger Skip-tab / Skip-site / Disable controls remain available in the popup notif card via `Store.suppress_idle` / `Store.suppress_tab_switch`.

| Builder | Suppress call | Manager init key |
|---|---|---|
| `_ssBlurStopActions()` | `Store.suppress_screen_share(scope, ctx)` | `ss_stop_actions` |
| `_ssResumeAction()` | `Store.unsuppress_screen_share('feature', ctx)` | `ss_resume_action` |

### Manager.init wiring

```js
blsi.Automate.Manager.init({
  tab_id: _initTabId,
  get_host_url: () => ({ host: _topHostname, url: location.href }),
  ss_stop_actions: _ssBlurStopActions,
  ss_resume_action: _ssResumeAction,
});
```

Wired once during `init()` (main frame only, after `Overlay.init()`). Runs even when `enabled === false` so re-enabling flips automate on without reload.

Module aliases (set at top of IIFE, not re-assigned):
- `Engine` → `blsi.BlurEngine`
- `Store` → `blsi.Model`
- `Selector` → `blsi.SelectorUtils`
- `Picker` → `blsi.Picker`
- `Shortcuts` → `blsi.Shortcuts`
- `Reveal` → `blsi.Reveal`
- `log` → `blsi.Logger.scope('content')`

---

## Core Patterns

### `_sync(preResolved?)`

**What:** Resolves settings and drives the blur engine. The single convergence point for all blur state changes.

**Params:**
- `preResolved` (object, optional) — a pre-resolved settings snapshot from `applyState`. When provided, skips the `Store.resolve()` call to avoid a redundant resolution. When omitted, resolves fresh from storage cache using `_topHostname` and `location.href`.

**Returns:** `Promise<void>`. No return value.

**Side effects:**
- Sets `settings` to the resolved snapshot.
- Calls `Engine.handleSite(resolved)` — the single entry point that applies blur-all, items, CSS vars, and observer setup.

**Handles:**
- All callers must `await` — concurrent invocations would interleave two reconcile passes and corrupt the engine's `_activeItems` Map.
- Fire-and-forget `_sync()` calls are a bug. Every call site uses `await _sync()`.

---

### `applyState(resolved, prev)`

**What:** Applies a resolved settings snapshot to all modules — shortcuts, picker, tab privacy, reveal, engine, AutoBlur, and PII detection. Idempotent: safe to call with identical settings. Callers must `await`.

**Params:**
- `resolved` (object) — full resolved settings snapshot from `Store.resolve()`. Must include all keys (`enabled`, `shortcuts`, `blur_radius`, `highlight_color`, `reveal_mode`, `tab_privacy`, `automate_screen_share`, `automate_idle`, `automate_tab_switch`, `pii_email`, `pii_numeric`, `pii_mode`).
- `prev` (object|null) — previous settings snapshot for change detection. If null, `settings` is used as the baseline.

**Returns:** `Promise<void>`.

**Side effects (in order):**
1. Computes changed keys via JSON comparison; logs them.
2. Shortcuts (main frame only): calls `Shortcuts.init(resolved.shortcuts, shortcutActionMap)` if enabled; `Shortcuts.destroy()` if disabled.
3. Picker: if picker is active and extension becomes disabled, deactivates picker via `Picker.deactivate()` + `setPickerActive(false)`. If still enabled, calls `Picker.setSettings({ blurRadius, highlightColor })`.
4. Tab privacy (main frame only): enables/disables `blsi.TabPrivacy` based on `resolved.tab_privacy && resolved.enabled`.
5. Reveal: calls `Reveal.clearAll()` if `reveal_mode` changed or extension is disabled.
6. Calls `await _sync(resolved)` — passes the snapshot through so engine does not re-resolve.
7. AutoBlur (main frame only): manages `blsi.Automate.ScreenShare.init()`/`destroy()` for screen-share detection (always evaluated). Manages `blsi.Automate.Visibility.init({tab_id})`/`destroy()` for tab-switch triggers. Screen-share state lives in the per-tab session map owned by background via `automate/screen_share_bg.js`.
8. PII detection: if any PII type enabled and extension enabled, calls `BlurEngine.injectPiiRules()` synchronously, then registers `BlurEngine.subscribeMutations('pii', PiiDetector.handleMutations)` **before** scheduling the scan — so dynamic content arriving between chunks is caught by `handleMutations` (which no-ops until `scan()` seeds `activeTypes`, and `isInsidePiiSpan` guards against re-wrapping nodes the scan already processed). Then schedules `PiiDetector.scan(body, types, onDone)` via `setTimeout(runScan, 0)` — starts on the next tick to avoid blocking the current frame but does not defer to idle (the previous `requestIdleCallback({ timeout: 2000 })` caused visible PII-detection lag on busy pages). The scan itself is **chunked** — it processes `CHUNK_SIZE` (500) text nodes per idle callback to avoid long-task violations. `scan()` cancels any in-flight chunked scan at the top, preventing concurrent scans from interleaving on rapid settings changes. Module-level `_piiScanIdleHandle` is cancelled on every fresh `applyState`, and the disable path also calls `PiiDetector.cancelChunkedScan()` to abort any in-flight chunked scan. Otherwise calls `BlurEngine.unsubscribeMutations('pii')`, `BlurEngine.removePiiRules()`, `PiiDetector.clear()`. PII detector owns no observer of its own.

**Handles:**
- Language change detection inside `handleStorageChange` (not inside `applyState` itself) triggers `ContentI18n.init(newLang)` and `Picker.rebuildToolbar()` before calling `applyState`.
- AutoBlur `onIdle` callback uses `reason` field (`'idle'` or `'tab_switch'`) to write the right trigger key and display the right toast. Idle-reason toast is suppressed when `_idleToastShown` is already `true`; tab-switch-reason toast always fires. The flag is reset on `visibilitychange` → visible so a tab-switch-and-back re-arms the idle toast.
- AutoBlur `onActive` callback patches both `{ idle: false, tab_switch: false }` atomically via `patch_automate_blur`.

---

### `setPickerActive(active)`

**What:** Single source of truth for picker-active state. Updates three pieces of state atomically. No-op in iframes (picker is main-frame only).

**Params:**
- `active` (boolean) — whether the picker is becoming active.

**Returns:** `undefined`.

**Side effects:**
- Sets `isPickerActive = active`.
- Calls `Shortcuts._setPickerActive(active)` — enables/disables Escape handling in the shortcut handler.
- Calls `Engine._setPickerActiveForObserver(active)` — gates the MutationObserver so it does not re-stamp elements while picker is open.

**Handles:**
- Every path that deactivates the picker (TOGGLE_PICKER handler, `pickerCallbacks.onDeactivate`, `applyState` disable path) must go through this function. Callers that update only a subset leave the observer silent for subsequent DOM mutations, which silently breaks dynamic-content stamping after picker closes.
- Returns immediately if `!IS_MAIN_FRAME`.

---

## Message Handlers

`handleMessage(message, _sender, sendResponse)` is registered as a `chrome.runtime.onMessage` listener. Iframes return `{ ok: false, reason: 'iframe' }` immediately and do not process messages. All messages (except `GET_STATUS`, `TOGGLE_PANEL`, `highlight_item`, `clear_highlight`) are short-circuited with `{ ok: false, reason: 'disabled' }` when `settings.enabled === false`.

Handlers that do async work (storage write + `_sync()`) return `true` from `handleMessage` to keep the message channel open for `sendResponse`.

**Dedup logic:** When `message.type` maps to an action id (via `MESSAGE_TO_ACTION_ID`), a fire-token is checked in `globalThis.__blsiShortcutFire[actionId]`. If the token was stamped within the last 500ms, the message is treated as a duplicate of the JS shortcut path and is responded with `{ ok: true, deduped: true }`. This prevents double-firing when both the JS shortcut handler and the `chrome.commands` relay reach `handleMessage` for the same keypress.

---

### `TOGGLE_BLUR_ALL` (`blsi.command.toggle_blur_all`)

**Trigger:** Alt+Shift+B shortcut (JS or chrome.commands relay), popup toggle.

**What:** Toggles blur-all on/off for the current hostname.

**Side effects:**
- Reads `Engine.isPageBlurred` to determine new state (toggle).
- Calls `Store.save_blur_state(hostname, newState)`.
- Calls `_sync()`.
- Responds with `{ isPageBlurred: newState }`.

**Returns:** `true` (async).

---

### `TOGGLE_PICKER` (`blsi.command.toggle_picker`)

**Trigger:** Alt+Shift+P shortcut (JS or chrome.commands relay), popup toggle.

**What:** Activates or deactivates the element picker.

**Side effects:**
- Reads `Store.resolve(_topHostname, location.href)` to get current `picker_mode` and `blur_radius`.
- If active: calls `Picker.deactivate()`, then `setPickerActive(false)`.
- If inactive: calls `Picker.activate({ blurRadius, highlightColor, pickerMode }, pickerCallbacks)`, then `setPickerActive(true)`.
- `message.picker_mode` overrides resolved `picker_mode` if provided.
- Responds with `{ isPickerActive }` (the NEW state after toggle).

**Returns:** `false` (synchronous).

---

### `GET_STATUS` (`blsi.popup.get_status`)

**Trigger:** Popup querying page state. Not gated by `settings.enabled` check.

**What:** Returns current page blur state synchronously.

**Side effects:** None.

**Returns:** `false`. Responds with `{ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount: Engine.blurredCount }`. `blurredCount` is an O(1) getter — no DOM scan.

---

### `highlight_item` (`blsi.popup.highlight_item`)

**Trigger:** Popup hovering over a blur item in its list. Not gated by `settings.enabled` check.

**What:** Highlights a specific blur item on the page.

**Side effects:** Calls `Engine.highlightItem(message)`.

**Returns:** `false`. Responds with `{ ok: true }`.

---

### `clear_highlight` (`blsi.popup.clear_highlight`)

**Trigger:** Popup mouse leaving a blur item in its list. Not gated by `settings.enabled` check.

**What:** Removes any active highlight applied by `highlight_item`.

**Side effects:** Calls `Engine.clearItemHighlight()`.

**Returns:** `false`. Responds with `{ ok: true }`.

---

### `CLEAR_ALL_BLUR` (`blsi.command.clear_all_blur`)

**Trigger:** Alt+Shift+U shortcut (JS or chrome.commands relay).

**What:** Clears all blur items and blur state for the current hostname.

**Side effects:**
- Calls `Store.clear_host(hostname)` — removes all items + blur state + automate_blur for hostname.
- Calls `Store.save_blur_state(hostname, false)` — explicitly disables blur-all.
- Calls `_sync()`.
- Responds with `{ ok: true }`.

**Returns:** `true` (async).

---

### `CONTEXT_BLUR` (`blsi.command.context_blur`)

**Trigger:** Context menu "Blur this element" item.

**What:** Blurs the element the user last right-clicked.

**Side effects:**
- Reads and clears `lastContextMenuTarget`.
- Calls `Selector.getSelectors(target)` to get selector list.
- Calls `Engine.allocateElementName()` for a unique blur item name.
- Constructs `{ type: 'dynamic', name, selectors }` item.
- Calls `Store.save_blur_item(hostname, item)` and inspects the `{ ok, reason }` result.
- If `reason === 'cap'`: fires the in-page cap toast via `_showCapToast()` (i18n `toast_pick_blur_cap_reached`).
- Calls `_sync()`.
- Responds with `{ ok: true }` on save, or `{ ok: false, reason }` when storage rejected (`'cap' | 'duplicate' | 'invalid'`).

**Handles:**
- No target: responds `{ ok: false, reason: 'no_target' }`, returns `false`.
- No selector: responds `{ ok: false, reason: 'no_selector' }`, returns `false`.
- Per-host cap reached: cap toast fired; storage untouched; response carries `reason: 'cap'`.

**Returns:** `true` if async path taken; `false` if early-exit.

---

### `CONTEXT_UNBLUR` (`blsi.command.context_unblur`)

**Trigger:** Context menu "Unblur this element" item.

**What:** Unblurs the nearest blurred ancestor of the right-clicked element.

**Side effects:**
- Reads and clears `lastContextMenuTarget`.
- Walks up from target to `document.documentElement` to find the nearest element where `Engine.isBlurred(node)` is true.
- Calls `Selector.getSelectors(unblurTarget)` to get selector list.
- Calls `Store.remove_blur_item(hostname, selectors[0])`.
- Calls `_sync()`.
- Responds with `{ ok: true }`.

**Handles:**
- No target: `{ ok: false, reason: 'no_target' }`.
- No blurred ancestor found: `{ ok: false, reason: 'not_blurred' }`.
- No selector: `{ ok: false, reason: 'no_selector' }`.

**Returns:** `true` if async path taken; `false` if early-exit.

---

### `blur_selection` (`blsi.command.blur_selection`)

**Trigger:** Shortcut action `'blur-selection'`, or shortcut action map entry.

**What:** Blurs the current text selection using `blsi.SelectionBlur`.

**Side effects:** Calls `blsi.SelectionBlur.blurSelection()`.

**Returns:** `false`. Responds with `{ ok: !!result }`.

---

### `TOGGLE_PANEL` (`blsi.command.toggle_panel`)

**Trigger:** Alt+Shift+O shortcut (PWA), context menu "Open Settings Panel" (PWA). Not gated by `settings.enabled` check.

**What:** Toggles visibility of the in-page settings panel (PWA only).

**Side effects:** Toggles `_pwaPanelHost.hidden`.

**Handles:** If `_pwaPanelHost` is null (non-PWA page), no-op.

**Returns:** `false`. Responds with `{ ok: true }`.

---

### `SCREEN_SHARE_NOTIFY` (`blsi.command.screen_share_notify`)

**Trigger:** Background broadcast on every transition of the screen-share session record (started, ended, port disconnect).

**What:** Re-syncs from the cached session record and toasts on the non-blurred → blurred transition.

**Side effects:**
- Captures `wasBlurring = _ssCurrentlyBlurring`.
- Calls `_sync()` — `Store.resolve()` factors the global record + per-site/per-tab suppression + sharing-tab skip; `_ssCurrentlyBlurring` is then re-stamped from `resolved.automate_blur_triggers.screen_share`.
- If `!wasBlurring && nowBlurring`: shows the 3-action stop-toast (15s) — `[This tab]`, `[This site (session)]`, `[Disable feature]`. Each action calls `Store.suppress_screen_share(scope, { hostname, tab_id })`. Fires regardless of whether blur-all or pick-and-blur is also active on the page.
- Responds `{ ok: true }`.

**Returns:** `true` (async).

**Note:** Storage `onChanged` ALSO triggers `_sync()` via `handleStorageChange` — the NOTIFY message exists purely to disambiguate the share-start moment from incremental session-record edits (e.g. a suppression list change), so the toast fires exactly once per share.

---

## Picker Callbacks

`pickerCallbacks` is passed to `Picker.activate()`. Each callback is an async function unless noted.

### `onBlur(el)`

**What:** Saves a new dynamic blur item for the element the picker just blurred.

**Params:** `el` (Element) — the blurred element.

**Side effects:**
- Calls `Selector.getSelectors(el)` — returns early if empty.
- Calls `Engine.allocateElementName()` for a unique name.
- Constructs `{ type: 'dynamic', name, selectors }` item.
- Calls `Store.save_blur_item(hostname, item)` — when the result reports `reason: 'cap'`, fires `_showCapToast()`.
- Calls `_sync()` (always, so the engine reconciles with whatever is in storage).

---

### `onUnblur(el)`

**What:** Removes the stored blur item for a picker-unblurred element.

**Params:** `el` (Element) — the element to un-persist.

**Side effects:**
- Calls `Selector.getSelectors(el)` — returns early if empty.
- Calls `Store.remove_blur_item(hostname, selectors[0])` using the first (most structural) selector.
- Calls `_sync()`.

---

### `onStickyBlur(zoneRect)`

**What:** Saves a new sticky zone blur item from a drawn zone.

**Params:** `zoneRect` (object) — `{ anchor: 'page'|'screen', x, y, width, height, scrollWidth, scrollHeight }`.

**Side effects:**
- Determines `anchor` from `zoneRect.anchor` before name allocation.
- Calls `Engine.allocateStickyName(anchor)` for a unique name matching the picker UI label.
- Generates a zone id via `_generateZoneId()` (format: `'s_' + 8 random alphanumeric chars`).
- Constructs full zone item including `xPct`, `yPct`, `widthPct`, `heightPct` (percentages relative to scroll dimensions, for re-projection on layout changes).
- Calls `Store.save_blur_item(hostname, item)` and inspects the result.
- Calls `_sync()`.
- When `reason === 'cap'`: fires the cap toast (`_showCapToast()`) and skips the zone-name toast.
- Otherwise: calls `blsi.Toast.show(name)` — briefly shows the zone name.

---

### `onStickyUnblur(zoneId)`

**What:** Removes a sticky zone blur item by id.

**Params:** `zoneId` (string) — the `id` field of the zone to remove.

**Side effects:**
- Calls `Store.remove_blur_item(hostname, zoneId)`.
- Calls `_sync()`.

---

### `onModeChange(mode)`

**What:** Persists picker mode change to storage when the user cycles the mode chip.

**Params:** `mode` (string) — new mode: `'dynamic'` | `'sticky-page'` | `'sticky-screen'`.

**Side effects:** Calls `Store.patch_section('pick_and_blur', { settings: { picker_mode: mode } })`. Does NOT call `_sync()` — mode is a UI preference, not a blur-state change.

---

### `onDeactivate()`

**What:** Called by picker when it deactivates itself (close button, Escape key with no active draw).

**Params:** None.

**Side effects:** Calls `setPickerActive(false)`.

---

## Shortcut Action Map

`shortcutActionMap` is passed as the `callbacks` argument to `Shortcuts.init()`. Keys are kebab-case action ids from `blsi.Actions`.

| Action id | Behavior |
|---|---|
| `'toggle-blur-all'` | Re-enters `handleMessage({ type: blsi.command.toggle_blur_all })` — JS-shortcut and chrome.commands paths converge |
| `'toggle-picker'` | Re-enters `handleMessage({ type: blsi.command.toggle_picker })` |
| `'clear-all'` | Directly calls `Store.clear_host` + `Store.save_blur_state(false)` + `_sync()` (does not re-enter handleMessage) |
| `'screenshot'` | Calls `blsi.Screenshot.captureViewport()` then `blsi.Screenshot.download(dataUrl)`; errors are logged |
| `'blur-selection'` | Re-enters `handleMessage({ type: blsi.command.blur_selection })` |
| `'onExitPicker'` | Calls `Picker.deactivate()` if `isPickerActive` (deactivate fires `pickerCallbacks.onDeactivate` which calls `setPickerActive(false)`) |

---

## SPA Detection

Handles SPA navigation in the main frame only. Wraps `history.pushState` and `history.replaceState` to fire `onUrlChange()`. Also listens for `popstate` and `hashchange` events.

### `onUrlChange()`

**What:** Debounced handler for URL changes. Re-resolves settings for the new URL and applies state.

**Side effects:**
- Debounces with a 150ms timer (`_urlChangeTimer`). Cancels any pending timer on each call.
- On fire: checks `location.href !== lastUrl`; no-op if unchanged.
- Updates `lastUrl` to current URL.
- Calls `Store.resolve(_topHostname, currentUrl)` then `applyState(resolved, prev)`.
- Errors are caught and logged as warnings (does not propagate).

**Handles:** Rapid SPA state pushes (e.g. scroll-based URL updates) are coalesced by the 150ms debounce.

---

## Cross-Frame Protocol

### Main frame to iframes: `_broadcastToFrames()`

**What:** Posts `{ type: 'BLSI_SETTINGS_CHANGED', topHostname: location.hostname }` to every direct child frame via `postMessage`. Uses `'*'` as the target origin so cross-origin iframes (e.g. `avcliq.zoho.in` inside `cliq.zoho.in`) receive the message. Safe because the payload is non-sensitive and the iframe listener validates `event.source === window.parent`.

**When called:** After `init()` completes, and after every `handleStorageChange()`.

**Side effects:** Each same-origin iframe's `window.message` listener receives the message, updates `_topHostname`, and calls `_sync()`.

**Handles:** Errors (cross-origin frame access) are silently caught inside the loop.

### Iframes receiving from main frame

**What:** Registered in iframes (when `!IS_MAIN_FRAME`). Listens for `BLSI_SETTINGS_CHANGED` from `window.parent` only (enforced by `event.source !== window.parent` guard).

**Side effects:** Updates `_topHostname` to `event.data.topHostname`, then calls `_sync()` so the iframe re-resolves blur-all state against the parent hostname.

---

## PWA Panel

### `_injectPwaPanel()`

**What:** Creates a shadow DOM host element containing a close button and an `<iframe>` pointing to `popup/popup.html`. Appended to `document.body`. Starts hidden.

**Returns:** The host `<div>` element (stored in `_pwaPanelHost`).

**Side effects:**
- Creates `<div id="bl-si-pwa-panel-host">` with closed shadow DOM.
- Shadow contains: scoped `<style>`, a wrapper `.w` div, a close button `.c`, and an `<iframe src="popup/popup.html">`.
- Close-button `aria-label` is resolved via `chrome.i18n.getMessage('aria_close_pwa_panel')` with English fallback.
- Registers `keydown` listener on `document` (capture phase) to close panel on Escape.
- Panel is toggled by setting `_pwaPanelHost.hidden`.

### `_checkPwaHint()`

**What:** Shows a one-time toast hint on PWA pages instructing the user how to open the settings panel.

**Side effects:**
- Reads `chrome.storage.local['blsi_pwa_hint_shown']`; no-op if already shown.
- Sets `blsi_pwa_hint_shown: true` in local storage.
- Calls `blsi.Toast.show(...)` with the i18n message `toast_pwa_hint`, passing the platform-appropriate shortcut label (Mac: `⌥⇧O`, others: `Alt+Shift+O`) as the `$SHORTCUT$` placeholder. Falls back to English when `chrome.i18n.getMessage` returns empty.

---

## Storage Change Handler: `handleStorageChange(newModel, _oldModel)`

**What:** Subscriber registered with `Store.on_change()`. Called on any change to the `blsi_model` storage key from any context (cross-tab, popup, background).

**Params:**
- `newModel` (object) — the new full model object (`blsi_model` value).
- `_oldModel` (object) — unused.

**Side effects:**
1. Returns immediately if `Engine` is falsy.
2. Calls `Store.resolve(_topHostname, location.href)` for fresh resolved settings.
3. Detects language change: if `newModel.global_default_settings.language` differs from `settings.language`, calls `ContentI18n.init(newLang)` then `Picker.rebuildToolbar()` (if picker is active).
4. Calls `applyState(resolved, prev)`.
5. If main frame: calls `_broadcastToFrames()`.

---

## Invariants

1. `setPickerActive(active)` is the ONLY path for mutating `isPickerActive`, `Shortcuts._setPickerActive`, and `Engine._setPickerActiveForObserver`. No call site touches these three independently.
2. Every `_sync()` call is awaited. No fire-and-forget.
3. All storage writes are followed by `_sync()` before returning from any handler.
4. `handleMessage` returns `true` from async handlers so the message channel stays open for `sendResponse`.
5. `applyState` passes the already-resolved snapshot to `_sync()` — no double-resolve in the same `applyState` call.
6. `Store.on_change()` is registered AFTER the initial `applyState()` call to avoid racing with cross-tab events during the cold-start window.
7. `_topHostname` in iframes is seeded from `document.referrer` and updated via postMessage. Blur-all decisions use `_topHostname`, not `hostname`, to follow the parent page's blur state.
8. `lastContextMenuTarget` is consumed and set to `null` on every `CONTEXT_BLUR` / `CONTEXT_UNBLUR` use.
9. SPA URL wrapping (`history.pushState`/`replaceState`, `popstate`, `hashchange`) is main-frame only.
10. The `settings.enabled === false` short-circuit in `handleMessage` does not apply to `GET_STATUS`, `TOGGLE_PANEL`, `highlight_item`, or `clear_highlight` — these must work regardless of enable state.
11. `Engine.resetCounters()` is called exactly once, in `init()`, before the first `applyState()`. Counter seeding happens inside the engine's `applyItem` — callers do not manage the high-water mark.
