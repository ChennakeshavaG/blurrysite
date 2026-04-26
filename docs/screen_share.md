# Screen Share Blur — Complete Architecture Reference

> **Purpose:** Exhaustive reference for every code path, storage value, message type,
> and UI interaction involved in the screen-share blur feature. Intended for debugging,
> onboarding, and architectural review. If something happens when a user shares their
> screen, it is documented here.

---

## Table of Contents

1. [One-Paragraph Summary](#1-one-paragraph-summary)
2. [Layer Map](#2-layer-map)
3. [Component Inventory](#3-component-inventory)
4. [Storage Reference](#4-storage-reference)
5. [Message & Event Protocol](#5-message--event-protocol)
6. [ASCII Flow Diagrams](#6-ascii-flow-diagrams)
   - 6a. [World Injection at Page Load](#6a-world-injection-at-page-load)
   - 6b. [Share Start — Full Signal Chain](#6b-share-start--full-signal-chain)
   - 6c. [Receiving Tab — Blur Application](#6c-receiving-tab--blur-application)
   - 6d. [New Tab Opened Mid-Share (Catch-Up)](#6d-new-tab-opened-mid-share-catch-up)
   - 6e. [Share End — Dual-Path Cleanup](#6e-share-end--dual-path-cleanup)
   - 6f. [Toast Action Buttons — 3-Way Decision Tree](#6f-toast-action-buttons--3-way-decision-tree)
   - 6g. [Popup Automate Banner](#6g-popup-automate-banner)
   - 6h. [Storage State Machine (2-Tab Scenario)](#6h-storage-state-machine-2-tab-scenario)
   - 6i. [resolve() Computed Field Derivation](#6i-resolve-computed-field-derivation)
   - 6j. [_sync() Call Chain](#6j-_sync-call-chain)
   - 6k. [Toast DOM Structure](#6k-toast-dom-structure)
   - 6l. [Full Interaction Sequence (Numbered)](#6l-full-interaction-sequence-numbered)
7. [Data Shapes — Complete Reference](#7-data-shapes--complete-reference)
8. [i18n Key Reference](#8-i18n-key-reference)
9. [CSS Reference](#9-css-reference)
10. [Edge Cases & Known Complexities](#10-edge-cases--known-complexities)

---

## 1. One-Paragraph Summary

When a user starts a screen share in **Tab A**, a MAIN-world script
(`main_world_bridge.js`) intercepts `navigator.mediaDevices.getDisplayMedia()`,
fires a CustomEvent, and an isolated-world bridge (`screen_share.js`) relays it
to the background service worker via a persistent Chrome runtime Port plus a
one-shot `sendMessage`. The background opens the port into an in-memory Map,
sets a session-storage flag, and fans out a `SCREEN_SHARE_BLUR` message to
every other open tab. Each receiving tab's content script writes
`automate_blur[hostname].screen_share = true` to session storage, calls
`_sync()` to re-resolve settings, and instructs the blur engine to inject CSS
and stamp DOM elements. A 15-second toast with three action buttons
(**This tab / This site / Disable**) lets the user stop the blur at different
scopes. When the share ends, the MAIN-world bridge fires `_dispatch(false)`,
the isolated-world bridge disconnects the port (triggering an `onDisconnect`
fan-out in the background as a crash-safety net), and also sends
`SCREEN_SHARE_ENDED` redundantly, so every tab receives `SCREEN_SHARE_UNBLUR`
regardless of race conditions.

---

## 2. Layer Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SCREEN SHARE BLUR — LAYER MAP                           │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PAGE (MAIN JS world)  — Tab A only                                     │    │
│  │  main_world_bridge.js  · wraps getDisplayMedia + attachShadow           │    │
│  │  Fires CustomEvent '__blsi_screen_share' on document                    │    │
│  └───────────────────────────┬─────────────────────────────────────────────┘    │
│                              │ CustomEvent (same document, cross-world)          │
│  ┌───────────────────────────▼─────────────────────────────────────────────┐    │
│  │  ISOLATED WORLD  — Tab A only                                           │    │
│  │  screen_share.js  · bridges CustomEvent → Chrome messaging              │    │
│  │  Opens Port 'blsi-screen-share' + sends SCREEN_SHARE_STARTED            │    │
│  └───────────────────────────┬─────────────────────────────────────────────┘    │
│                              │ Port connect + sendMessage                        │
│  ┌───────────────────────────▼─────────────────────────────────────────────┐    │
│  │  BACKGROUND SERVICE WORKER                                              │    │
│  │  background.js  · in-memory _sharePorts Map · session-flag writes       │    │
│  │  Fans out SCREEN_SHARE_BLUR to other tabs                               │    │
│  │  Fans out SCREEN_SHARE_UNBLUR to all tabs on end/disconnect             │    │
│  └──────┬──────────────────────────────────────────────────────┬───────────┘    │
│         │ tabs.sendMessage(BLUR)                                │ (UNBLUR)       │
│  ┌──────▼──────────┐   ┌─────────────────┐   ┌───────────────▼────────────┐    │
│  │ content_script  │   │ content_script  │   │ content_script  · Tab A   │    │
│  │  Tab B          │   │  Tab C          │   │ (sender — NOT blurred)     │    │
│  │  · handleMsg    │   │  · handleMsg    │   │  receives UNBLUR on end    │    │
│  │  · _sync()      │   │  · _sync()      │   └────────────────────────────┘    │
│  │  · blur DOM     │   │  · blur DOM     │                                      │
│  └──────┬──────────┘   └────────┬────────┘                                      │
│         │ write                  │ write                                         │
│  ┌──────▼────────────────────────▼────────────────────────────────────────┐     │
│  │  chrome.storage.session                                                 │     │
│  │  blsi_screen_share_active  : boolean                                   │     │
│  │  blsi_automate_blur        : { [hostname]: { screen_share: bool, … } } │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  POPUP  (separate document, chrome-extension:// URL)                    │    │
│  │  popup_state.js  · reads _automate_cache via get_automate_blur()        │    │
│  │  renders/main.js · shows "Active: Screen Share" banner                  │    │
│  │  Buttons: [Stop Screen Share Blur]  [Turn Off]                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Inventory

| File | JS World | run_at | all_frames | Role |
|------|----------|--------|------------|------|
| `src/main_world_bridge.js` | MAIN | document_start | false | Intercepts `getDisplayMedia` + `attachShadow`; fires CustomEvents |
| `src/screen_share.js` | Isolated | document_idle | true | Bridges CustomEvent → Chrome Port + message |
| `background.js` | Service Worker | — | — | Port tracking; session-flag; fan-out orchestration |
| `src/content_script.js` | Isolated | document_idle | true | Handles BLUR/UNBLUR; writes automate session state; calls _sync() |
| `src/storage_model.js` | Isolated | document_idle | true | CRUD for `blsi_automate_blur` session key; `resolve()` computation |
| `src/blur_engine.js` | Isolated | document_idle | true | `handleSite()` — injects CSS, stamps DOM, observes MutationObserver |
| `src/shortcut_handler.js` | Isolated | document_idle | true | `showToast()` — renders the 15s in-page notification |
| `src/constants.js` | Isolated | document_idle | true | Defines `blsi.command.screen_share_*` string constants |
| `popup/popup_state.js` | Popup | — | — | `clearScreenShareBlur()`, `clearAutomateBlur()` |
| `popup/popup.js` | Popup | — | — | `_onClearScreenShareBlur()`, `_onClearAutomate()` wiring |
| `popup/renders/main.js` | Popup | — | — | `renderAutomateSection()` — banner + action buttons |

---

## 4. Storage Reference

### 4a. chrome.storage.session — `blsi_screen_share_active`

```
Key:      blsi_screen_share_active
Type:     boolean
Default:  false
```

| Event | New value | Set by |
|-------|-----------|--------|
| Service worker starts (every SW wake) | `false` | `background.js` line 63 |
| Port `'blsi-screen-share'` connects | `true` | `background.js` line 151 |
| `SCREEN_SHARE_STARTED` message received | `true` | `background.js` line 192 |
| Port disconnects (`onDisconnect`) | `false` | `background.js` line 158 |
| `SCREEN_SHARE_ENDED` message received | `false` | `background.js` line 205 |

**Read by:** `content_script.js` at init step 9b — catch-up for tabs opened while a share is already active.

```
chrome.storage.session
┌────────────────────────────────────────────┐
│  blsi_screen_share_active                  │
│                                            │
│  false ──share starts──► true             │
│  true  ──share ends───► false             │
│  ?     ──SW wakes─────► false  (reset)    │
└────────────────────────────────────────────┘
```

---

### 4b. chrome.storage.session — `blsi_automate_blur`

```
Key:      blsi_automate_blur
Type:     object  { [hostname: string]: TriggerEntry }
Default:  {}
```

```
TriggerEntry shape:
{
  idle:         boolean,   // idle timer trigger active for this hostname
  tab_switch:   boolean,   // tab-switch trigger active for this hostname
  screen_share: boolean,   // screen-share trigger active for this hostname
}
```

**Full example value during an active screen share on two sites:**

```json
{
  "github.com": {
    "idle":         false,
    "tab_switch":   false,
    "screen_share": true
  },
  "docs.google.com": {
    "idle":         true,
    "tab_switch":   false,
    "screen_share": true
  }
}
```

**Who reads / writes it:**

| Operation | Function | File | Notes |
|-----------|----------|------|-------|
| Read one hostname | `get_automate_blur(hostname)` | `storage_model.js` | Synchronous; reads `_automate_cache` |
| Write one trigger | `save_automate_blur(hostname, trigger, bool)` | `storage_model.js` | Async; updates `_automate_cache` before write |
| Batch-write | `patch_automate_blur(hostname, patch)` | `storage_model.js` | Async; one storage write |
| Clear hostname | `clear_automate_blur(hostname)` | `storage_model.js` | Deletes the hostname key entirely |
| Read for resolve | `resolve(hostname, url)` | `storage_model.js` | Reads `_automate_cache` inline |
| Set screen_share=true | SCREEN_SHARE_BLUR handler | `content_script.js` | Per-tab, after DOM ready |
| Set screen_share=false | SCREEN_SHARE_UNBLUR handler | `content_script.js` | Per-tab, on unblur |
| Set screen_share=false | "This tab" toast action | `content_script.js` | + sets `_ssBlurSuppressed` |
| Set screen_share=false | "This site" toast action | `content_script.js` | All tabs see onChanged |
| Set screen_share=false | Popup "Stop SS Blur" btn | `popup_state.js` | Via `clearScreenShareBlur()` |
| Delete hostname entry | Popup "Turn Off" btn | `popup_state.js` | Via `clearAutomateBlur()` |

**In-memory mirror:** `_automate_cache` in `storage_model.js` — always updated synchronously before the async `chrome.storage.session.set()` call. This prevents self-echo on `storage.onChanged`.

---

### 4c. chrome.storage.local — `blsi_model`

Only one field is screen-share-relevant:

```
blsi_model.automate.settings.screen_share
Type:    { enabled: boolean }
Default: { enabled: false }
```

**Modified by:** "Disable" toast action (`Store.patch_section('automate', { settings: { screen_share: { enabled: false } } })`).  
**Read by:** Every content_script that receives `SCREEN_SHARE_BLUR` — if `enabled === false`, the message is silently ignored.  
**Visible in:** Popup → Automate sub-page → Screen Share toggle.

---

### 4d. In-Memory (per tab, not persisted)

```
Variable:  _ssBlurSuppressed
Type:      boolean
Default:   false
Declared:  content_script.js (inside IIFE)
Scope:     Single tab, for the tab's lifetime (NOT cleared on SPA navigation)
```

**Set to `true` by:** "This tab" toast action onClick.  
**Checked at:** Top of the `SCREEN_SHARE_BLUR` message handler — if true, message is silently dropped with `{ ok: false, reason: 'tab-suppressed' }`.

```
Per-tab memory state:
┌────────────────────────────────────────────────────────────┐
│  _ssBlurSuppressed = false   (initial)                     │
│                                                            │
│  User clicks "This tab" in toast                           │
│    ↓                                                       │
│  _ssBlurSuppressed = true                                  │
│                                                            │
│  Next SCREEN_SHARE_BLUR message arrives                    │
│    ↓                                                       │
│  if (_ssBlurSuppressed) → sendResponse({ok:false}) → break │
│  ↑ message silently dropped, DOM stays unblurred           │
│                                                            │
│  Tab closed or full page reload                            │
│    ↓                                                       │
│  content_script re-runs → _ssBlurSuppressed = false        │
└────────────────────────────────────────────────────────────┘
```

---

### 4e. In-Memory Background — `_sharePorts`

```
Variable:  _sharePorts
Type:      Map<tabId: number, port: chrome.runtime.Port>
Declared:  background.js line 140
Scope:     Service worker lifetime (empty on every SW restart)
```

Used to associate a connected port with the sharing tab's ID. On SW restart, the Map is always empty — ports are re-established by `screen_share.js` init if a share is somehow still active.

---

## 5. Message & Event Protocol

### 5a. Complete Protocol Table

| # | Mechanism | Name / Payload | Direction | Trigger |
|---|-----------|---------------|-----------|---------|
| 1 | CustomEvent on `document` | `'__blsi_screen_share'` `{ detail: { active: boolean } }` | MAIN → isolated (same tab) | `getDisplayMedia()` succeeds or all tracks end |
| 2 | `chrome.runtime.connect()` | Port name: `'blsi-screen-share'` | isolated → background | `active === true` in CustomEvent |
| 3 | `chrome.runtime.sendMessage()` | `{ type: 'SCREEN_SHARE_STARTED' }` | isolated → background | Same as port open (slightly after) |
| 4 | `chrome.tabs.sendMessage()` | `{ type: 'SCREEN_SHARE_BLUR' }` | background → other tabs | Received `SCREEN_SHARE_STARTED` |
| 5 | Port `.disconnect()` | _(no payload)_ | isolated → background | `active === false` in CustomEvent (or tab crash/close/nav) |
| 6 | `chrome.runtime.sendMessage()` | `{ type: 'SCREEN_SHARE_ENDED' }` | isolated → background | `active === false` in CustomEvent |
| 7 | `chrome.tabs.sendMessage()` | `{ type: 'SCREEN_SHARE_UNBLUR' }` | background → ALL tabs | Port disconnect OR `SCREEN_SHARE_ENDED` received |
| 8 | CustomEvent on `document` | `'__blsi_shadow_attached'` _(not SS-specific)_ | MAIN → isolated | `Element.prototype.attachShadow()` called with non-closed mode |

### 5b. Message Type String Values (from `src/constants.js`)

```javascript
blsi.command.screen_share_started  === 'SCREEN_SHARE_STARTED'
blsi.command.screen_share_ended    === 'SCREEN_SHARE_ENDED'
blsi.command.screen_share_blur     === 'SCREEN_SHARE_BLUR'
blsi.command.screen_share_unblur   === 'SCREEN_SHARE_UNBLUR'
```

### 5c. Why Both Port AND sendMessage?

```
REASON: Crash/navigation safety.
                                                               ┌──────────────┐
Port 'blsi-screen-share' ──── onDisconnect always fires ────► │  BACKGROUND  │
                               even on tab crash / close /     │  fans out    │
                               navigation away from page.      │  UNBLUR      │
                                                               └──────────────┘
sendMessage(SCREEN_SHARE_STARTED/ENDED) ──── explicit signal
  for share start/end while port is alive.

Result: the port is the safety net for abnormal termination;
        the messages carry the structured event payload.
```

---

## 6. ASCII Flow Diagrams

### 6a. World Injection at Page Load

```
                 manifest.json
                      │
         ┌────────────┴────────────────────┐
         │                                 │
         ▼                                 ▼
  content_scripts[0]               content_scripts[1]
  world: "MAIN"                    (isolated world, default)
  run_at: "document_start"         run_at: "document_idle"
  all_frames: false                all_frames: true
  files: [main_world_bridge.js]    files: [constants.js,
                                           …(14 more)…,
                                           screen_share.js,
                                           …,
                                           content_script.js]
         │                                 │
         ▼                                 ▼
  Runs BEFORE any page JS          Runs AFTER DOM idle

  ┌──────────────────────────┐     ┌────────────────────────────────────────┐
  │ main_world_bridge.js     │     │ screen_share.js                        │
  │                          │     │                                        │
  │ PATCH 1:                 │     │ Runs after constants.js (which sets    │
  │  _origGetDisplayMedia =  │     │ blsi.command.screen_share_started etc) │
  │   nav.mediaDevices       │     │                                        │
  │   .getDisplayMedia       │     │ blsi.ScreenShare = {                   │
  │                          │     │   init()    // registers listener      │
  │  nav.mediaDevices        │     │   destroy() // removes listener        │
  │   .getDisplayMedia =     │     │ }                                      │
  │   async (constraints) {  │     │                                        │
  │     stream = await orig  │     │ init() is called from content_script   │
  │     _dispatch(true)      │     │ applyState() when screen_share.enabled │
  │     attachTrackListeners │     │                                        │
  │     return stream        │     │ On '__blsi_screen_share' event:        │
  │   }                      │     │   active=true  → open port + message   │
  │                          │     │   active=false → disconnect + message  │
  │ PATCH 2:                 │     └────────────────────────────────────────┘
  │  _origAttachShadow =     │
  │   Element.prototype      │
  │   .attachShadow          │
  │                          │
  │  Element.prototype       │
  │   .attachShadow = fn {   │
  │     shadow = orig(init)  │
  │     if (!closed)         │
  │       dispatch(          │
  │        '__blsi_shadow    │
  │         _attached')      │
  │     return shadow        │
  │   }                      │
  └──────────────────────────┘
```

---

### 6b. Share Start — Full Signal Chain

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                        SCREEN SHARE START — FULL CHAIN                      ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Tab A (sharing tab)
  ───────────────────────────────────────────────────────────────────────────────

  Web app calls:  navigator.mediaDevices.getDisplayMedia({ video: true })
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  main_world_bridge.js  (MAIN world)                                     │
  │                                                                         │
  │  var stream = await _origGetDisplayMedia(constraints)                   │
  │                                ↓                                        │
  │                         stream returned                                 │
  │                                ↓                                        │
  │  _dispatchScreenShare(true)                                             │
  │     document.dispatchEvent(                                             │
  │       new CustomEvent('__blsi_screen_share',                            │
  │                       { detail: { active: true } })                     │
  │     )                                                                   │
  │                                ↓                                        │
  │  Attach 'ended' listener to each track                                  │
  │  (fires _dispatchScreenShare(false) when all tracks end)                │
  │                                                                         │
  │  return stream  (to web app)                                            │
  └─────────────────────────┬───────────────────────────────────────────────┘
                            │
                            │  CustomEvent '__blsi_screen_share'
                            │  { detail: { active: true } }
                            │  (cross-world, same document)
                            ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  screen_share.js  (isolated world, Tab A)                               │
  │                                                                         │
  │  _handler(e):                                                           │
  │    e.detail.active === true                                             │
  │                                                                         │
  │    ① _sharePort = chrome.runtime.connect({                              │
  │         name: 'blsi-screen-share'                                       │
  │       })                                                                │
  │                                                                         │
  │    ② chrome.runtime.sendMessage({                                       │
  │         type: blsi.command.screen_share_started  // 'SCREEN_SHARE_STARTED'
  │       }).catch(() => {})                                                │
  └──────────┬───────────────────────────────┬────────────────────────────-┘
             │  Port connect (①)             │  sendMessage (②)
             ▼                               ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  background.js  (Service Worker)                                        │
  │                                                                         │
  │  ── onConnect handler ──────────────────────────────────────────────    │
  │  port.name === 'blsi-screen-share'   ✓                                  │
  │  tabId = port.sender.tab.id          (Tab A's tabId)                    │
  │                                                                         │
  │  _sharePorts.set(tabId, port)        Map: { tabA → port }              │
  │                                                                         │
  │  chrome.storage.session.set({                                           │
  │    blsi_screen_share_active: true                                       │
  │  })                                                                     │
  │                                                                         │
  │  port.onDisconnect listener registered (for crash-safety)               │
  │                                                                         │
  │  ── onMessage handler (SCREEN_SHARE_STARTED) ───────────────────────   │
  │  chrome.storage.session.set({                                           │
  │    blsi_screen_share_active: true    ← redundant, belt-and-suspenders  │
  │  })                                                                     │
  │                                                                         │
  │  FAN-OUT: chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })     │
  │    for each tab:                                                        │
  │      if (tab.id !== tabA)   ← SKIP the sharing tab                     │
  │        chrome.tabs.sendMessage(tab.id,                                  │
  │          { type: blsi.command.screen_share_blur })   ← 'SCREEN_SHARE_BLUR'
  │        .catch(() => {})      ← silent if tab has no content_script      │
  │                                                                         │
  │  sendResponse({ ok: true })                                             │
  └─────────────────────────────────────────────────────────────────────────┘
             │
             │  tabs.sendMessage({ type: 'SCREEN_SHARE_BLUR' })
             │  ← sent to Tab B, Tab C, Tab D … (all except Tab A)
             │
             ▼
       [see diagram 6c]
```

---

### 6c. Receiving Tab — Blur Application

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                   RECEIVING TAB — SCREEN_SHARE_BLUR HANDLER                 ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Tab B (any tab that is NOT the sharer)
  ───────────────────────────────────────────────────────────────────────────────

  background.js calls: chrome.tabs.sendMessage(tabB, { type: 'SCREEN_SHARE_BLUR' })
                                    │
                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  content_script.js  handleMessage()                                     │
  │                                                                         │
  │  case blsi.command.screen_share_blur:                                   │
  │                                                                         │
  │  GUARD ①: if (_ssBlurSuppressed)                                        │
  │    → sendResponse({ ok: false, reason: 'tab-suppressed' })              │
  │    → break   ←── message silently dropped, nothing happens              │
  │                                                                         │
  │  READ automate config from cached model:                                │
  │    const am_s = (Store.get().automate || {}).settings || {}             │
  │                                                                         │
  │  GUARD ②: if (!(am_s.screen_share || {}).enabled)                       │
  │    → sendResponse({ ok: false, reason: 'disabled' })                   │
  │    → break   ←── feature globally disabled, nothing happens             │
  │                                                                         │
  │  (async () => {                                                         │
  │    ①  await Store.save_automate_blur(                                   │
  │             hostname,                                                   │
  │             'screen_share',                                             │
  │             true                                                        │
  │           )                                                             │
  │       ┌──────────────────────────────────────────────────────────┐      │
  │       │  storage_model.js  save_automate_blur()                  │      │
  │       │                                                          │      │
  │       │  Reads _automate_cache for this hostname                 │      │
  │       │  Sets entry.screen_share = true                          │      │
  │       │  _automate_cache[hostname] = entry   ← sync update      │      │
  │       │  _session_set(_automate_cache)        ← async write     │      │
  │       │    chrome.storage.session['blsi_automate_blur'] =       │      │
  │       │      { "github.com": { ..., screen_share: true } }      │      │
  │       └──────────────────────────────────────────────────────────┘      │
  │                                                                         │
  │    ②  await _sync()  ─────────────────────────────────────────────────  │
  │       │  (see diagram 6j for full _sync() chain)                        │
  │       │  Result: blur_all_active=true, DOM stamped                      │
  │       └──────────────────────────────────────────────────────────────   │
  │                                                                         │
  │    ③  if (settings.automate_blur_only):                                 │
  │         Shortcuts.showToast(                                            │
  │           chrome.i18n.getMessage('automate_toast_screen_share'),        │
  │           15000,        ← 15-second auto-hide                           │
  │           _ssBlurStopActions()   ← 3 action buttons                     │
  │         )                                                               │
  │         ┌─────────────────────────────────────────────────────────┐     │
  │         │ Toast renders (see diagram 6k for DOM structure):        │     │
  │         │                                                         │     │
  │         │ ┌─────────────────────────────────────────────────┐    │     │
  │         │ │ 🔵 Blur applied — screen share active        [✕] │    │     │
  │         │ │    [This tab]  [This site]  [Disable]            │    │     │
  │         │ └─────────────────────────────────────────────────┘    │     │
  │         └─────────────────────────────────────────────────────────┘     │
  │                                                                         │
  │       if (settings.automate_blur_skipped):                              │
  │         Shortcuts.showToast(                                            │
  │           chrome.i18n.getMessage('automate_toast_skipped'),             │
  │           2500          ← 2.5s, no action buttons                       │
  │         )                                                               │
  │         ┌─────────────────────────────────────────────────────────┐     │
  │         │ Note: automate_blur_only and automate_blur_skipped are  │     │
  │         │ mutually exclusive (only one toast can show):           │     │
  │         │   _only    = automate active + NO manual blur           │     │
  │         │   _skipped = automate active + manual blur ALREADY on   │     │
  │         └─────────────────────────────────────────────────────────┘     │
  │                                                                         │
  │    sendResponse({ ok: true })                                           │
  │  })();                                                                  │
  │  return true;   ← tells Chrome the response is async                   │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

### 6d. New Tab Opened Mid-Share (Catch-Up)

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                       NEW TAB CATCH-UP PATH (init step 9b)                  ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Problem: Tab D opens AFTER the SCREEN_SHARE_STARTED fan-out has already fired.
           Tab D was not open at that moment, so it missed SCREEN_SHARE_BLUR.
           Without the catch-up path, Tab D would not be blurred during the share.

  Solution: On init, every content_script checks blsi_screen_share_active in session.

  Tab D loads (navigation or new tab)
            │
            ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  content_script.js  init()  — step 9b                                  │
  │                                                                         │
  │  if (IS_MAIN_FRAME):     ← only main frame does the check               │
  │    try {                                                                │
  │      const ss = await chrome.storage.session.get(                      │
  │                          'blsi_screen_share_active'                     │
  │                        )                                               │
  │                                                                         │
  │      const screen_share_cfg = resolved.automate_screen_share || {}     │
  │       ↑ resolved = Store.resolve(_topHostname, location.href)           │
  │         called earlier in init at step 2                               │
  │                                                                         │
  │      if (ss.blsi_screen_share_active          ← flag is true           │
  │          && screen_share_cfg.enabled) {        ← feature is enabled    │
  │                                                                         │
  │        await Store.save_automate_blur(                                  │
  │                 hostname, 'screen_share', true                          │
  │               )                                                         │
  │        await _sync()                                                    │
  │                                                                         │
  │        if (settings.automate_blur_only)                                 │
  │          Shortcuts.showToast(                                           │
  │            '...screen share active...',                                 │
  │            15000,                                                       │
  │            _ssBlurStopActions()                                         │
  │          )                                                               │
  │        if (settings.automate_blur_skipped)                              │
  │          Shortcuts.showToast('...already active...', 2500)              │
  │      }                                                                  │
  │    } catch (_e) {}    ← swallowed — session read failure is non-fatal   │
  └─────────────────────────────────────────────────────────────────────────┘

  Timeline illustration:

  t=0   Share starts in Tab A  ──►  SCREEN_SHARE_BLUR sent to Tab B, C
  t=5s  Tab D opens
        content_script.init()
        reads blsi_screen_share_active === true
        ──►  Tab D gets blurred (same UX as Tabs B and C)
  t=30s Share ends in Tab A
        ──►  SCREEN_SHARE_UNBLUR to all tabs (B, C, D)
        ──►  All tabs unblur
```

---

### 6e. Share End — Dual-Path Cleanup

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                     SCREEN SHARE END — DUAL-PATH CLEANUP                    ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  All screen share tracks end (user clicks "Stop sharing" in browser chrome)
             │
             ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  main_world_bridge.js  (MAIN world, Tab A)                              │
  │                                                                         │
  │  Track 'ended' listener fires (for each track)                          │
  │  if (--pending === 0)   ← all tracks ended                              │
  │    _dispatchScreenShare(false)                                          │
  │      document.dispatchEvent(                                            │
  │        new CustomEvent('__blsi_screen_share',                           │
  │                        { detail: { active: false } })                   │
  │      )                                                                  │
  └──────────────────────────┬──────────────────────────────────────────────┘
                             │  CustomEvent (cross-world, same doc, Tab A)
                             ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  screen_share.js  _handler  (isolated world, Tab A)                     │
  │                                                                         │
  │  e.detail.active === false                                              │
  │                                                                         │
  │  PATH A (primary — crash-safety net):                                   │
  │    if (_sharePort):                                                     │
  │      _sharePort.disconnect()   ←── triggers background onDisconnect     │
  │      _sharePort = null                                                  │
  │                                                                         │
  │  PATH B (redundant — belt-and-suspenders):                              │
  │    chrome.runtime.sendMessage({                                         │
  │      type: blsi.command.screen_share_ended   // 'SCREEN_SHARE_ENDED'   │
  │    }).catch(() => {})                                                   │
  └──────────┬────────────────────────────────┬────────────────────────────┘
             │  Port disconnect (PATH A)      │  sendMessage (PATH B)
             ▼                               ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  background.js  (Service Worker)                                        │
  │                                                                         │
  │  ── PATH A: port.onDisconnect ──────────────────────────────────────    │
  │  _sharePorts.delete(tabId)                                              │
  │  chrome.storage.session.set({ blsi_screen_share_active: false })        │
  │  FAN-OUT to ALL tabs (no exclusion — Tab A included):                   │
  │    chrome.tabs.sendMessage(tab.id,                                      │
  │      { type: blsi.command.screen_share_unblur }   // 'SCREEN_SHARE_UNBLUR'
  │    ).catch(() => {})                                                    │
  │                                                                         │
  │  ── PATH B: onMessage(SCREEN_SHARE_ENDED) ──────────────────────────   │
  │  chrome.storage.session.set({ blsi_screen_share_active: false })        │
  │  FAN-OUT to ALL tabs (same fan-out, Tab A included):                    │
  │    chrome.tabs.sendMessage(tab.id,                                      │
  │      { type: blsi.command.screen_share_unblur }                        │
  │    ).catch(() => {})                                                    │
  │  sendResponse({ ok: true })                                             │
  │                                                                         │
  │  ┌───────────────────────────────────────────────────────────────┐      │
  │  │  NOTE: Both paths fire for a normal share end. Each fan-out   │      │
  │  │  sends SCREEN_SHARE_UNBLUR independently. Tabs receive the    │      │
  │  │  message twice. The UNBLUR handler is idempotent — calling    │      │
  │  │  save_automate_blur(host, 'screen_share', false) twice is     │      │
  │  │  harmless (already false after first call).                   │      │
  │  └───────────────────────────────────────────────────────────────┘      │
  └─────────────────────────────────────────────────────────────────────────┘
             │
             │  SCREEN_SHARE_UNBLUR to ALL tabs (A, B, C, D, …)
             ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  content_script.js  handleMessage()  (every tab)                        │
  │                                                                         │
  │  case blsi.command.screen_share_unblur:                                 │
  │                                                                         │
  │  (async () => {                                                         │
  │    await Store.save_automate_blur(                                      │
  │             hostname, 'screen_share', false                             │
  │           )                                                             │
  │    await _sync()                                                        │
  │       ↓ _sync resolves settings again                                   │
  │       ↓ automate_blur_active = false (screen_share=false)               │
  │       ↓ blur_all_active = false (if no manual blur active)              │
  │       ↓ Engine.handleSite(resolved) → removes CSS + unstamps DOM        │
  │  })();                                                                  │
  │  return true;                                                           │
  │                                                                         │
  │  [No toast shown on unblur]                                             │
  └─────────────────────────────────────────────────────────────────────────┘

  Abnormal termination paths (same onDisconnect fan-out, PATH A only):

  ┌─────────────────────────────────────────────────────────────────────────┐
  │  Tab A CRASHES                                                          │
  │    Port disconnects automatically → onDisconnect fires → UNBLUR fan-out │
  │                                                                         │
  │  Tab A CLOSES (user closes tab)                                         │
  │    Port disconnects automatically → same                                │
  │                                                                         │
  │  Tab A NAVIGATES to another page                                        │
  │    screen_share.js destroy() called (content_script teardown)           │
  │    destroy() calls _sharePort.disconnect() explicitly                   │
  │    → same onDisconnect fan-out                                          │
  │                                                                         │
  │  SERVICE WORKER WAKES (SW restart)                                      │
  │    _sharePorts is an in-memory Map → always empty on restart            │
  │    SW startup sets blsi_screen_share_active = false                     │
  │    New tabs opening after restart will see false → no catch-up blur     │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

### 6f. Toast Action Buttons — 3-Way Decision Tree

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                     TOAST ACTION BUTTONS — 3-WAY DECISION TREE              ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Toast shown in each blurred tab after SCREEN_SHARE_BLUR processed:

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 🔵  Blur applied — screen share active                          [✕] │
  │      [This tab]          [This site]         [Disable]              │
  │       (blue)              (blue)              (amber/warn)           │
  └─────────────────────────────────────────────────────────────────────┘
  │                          │                          │
  │                          │                          │
  ▼                          ▼                          ▼

  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
  │   "This tab"     │  │   "This site"    │  │       "Disable"          │
  │   (per-tab       │  │   (per-domain    │  │   (global feature off)   │
  │    suppression)  │  │    clear)        │  │                          │
  └────────┬─────────┘  └────────┬─────────┘  └──────────────┬───────────┘
           │                     │                            │
           ▼                     ▼                            ▼

  _ssBlurSuppressed = true    (nothing extra)         Store.patch_section(
                                                       'automate',
  Store.save_automate_blur(   Store.save_automate_blur( {settings:{
    hostname,                   hostname,                screen_share:{
    'screen_share',             'screen_share',            enabled:false
    false                       false                    }
  )                           )                        }})
           │                     │                            │
           ▼                     ▼                            ▼
       await _sync()         await _sync()               Store.save_automate_blur(
                                                           hostname,
                                                           'screen_share',
                                                           false
                                                         )
                                                                │
                                                                ▼
                                                           await _sync()
           │                     │                            │
           ▼                     ▼                            ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  _sync() → Store.resolve() → Engine.handleSite(resolved)             │
  │  blur_all_active=false → CSS removed → DOM unstamped → page unblurs  │
  └──────────────────────────────────────────────────────────────────────┘

  Persistence comparison:

  ┌──────────────────┬─────────────────────────────┬──────────────────────────┐
  │  Action          │  Where stored               │  Lifetime                │
  ├──────────────────┼─────────────────────────────┼──────────────────────────┤
  │  This tab        │  In-memory only             │  Until tab closes/nav    │
  │                  │  (_ssBlurSuppressed=true)   │                          │
  │                  │  + session automate clear   │                          │
  ├──────────────────┼─────────────────────────────┼──────────────────────────┤
  │  This site       │  chrome.storage.session     │  Until browser restart   │
  │                  │  automate_blur[host]        │  (session storage)       │
  │                  │    .screen_share = false    │                          │
  ├──────────────────┼─────────────────────────────┼──────────────────────────┤
  │  Disable         │  chrome.storage.local       │  Persistent (until user  │
  │                  │  blsi_model.automate        │  re-enables in popup)    │
  │                  │    .settings.screen_share   │                          │
  │                  │    .enabled = false         │                          │
  └──────────────────┴─────────────────────────────┴──────────────────────────┘

  Re-blur eligibility after each action if a NEW screen share starts:

  ┌──────────────────┬────────────────────────────────────────────────────────┐
  │  "This tab"      │  Next SCREEN_SHARE_BLUR → dropped (guard ① fires)      │
  │                  │  All other tabs → blurred normally                     │
  ├──────────────────┼────────────────────────────────────────────────────────┤
  │  "This site"     │  Next SCREEN_SHARE_BLUR → processed (no guard)         │
  │                  │  Session cleared → start fresh → re-blurred            │
  ├──────────────────┼────────────────────────────────────────────────────────┤
  │  "Disable"       │  Next SCREEN_SHARE_BLUR → dropped (guard ② fires:      │
  │                  │  screen_share.enabled === false)                       │
  │                  │  Persists across browser restarts                      │
  └──────────────────┴────────────────────────────────────────────────────────┘
```

---

### 6g. Popup Automate Banner

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                         POPUP AUTOMATE BANNER FLOW                          ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  User opens extension popup while screen share blur is active:

  popup.js  init()
       │
       ▼
  State.setModel(blsi.Model.get())   ← reads from _cache (local model)
  State.get()  →  _build_flat_settings(model)
                     │
                     ├── automate_blur_active:
                     │     blsi.Model.get_automate_blur(hostname)
                     │       ← reads _automate_cache (session)
                     │       → { idle: false, tab_switch: false, screen_share: true }
                     │     !!(false || false || true) === true
                     │
                     └── automate_blur_triggers:
                           { idle: false, tab_switch: false, screen_share: true }
       │
       ▼
  BlurrySitePopupRender.renderAll(settings, blurItems, isPageBlurred,
                                  _onSave, _onClearAutomate, _onClearScreenShareBlur)
       │
       └─► renderAutomateSection(settings, onClearAutomate, onClearScreenShareBlur)
                 │
                 │  settings.automate_blur_active === true
                 ▼
          ┌───────────────────────────────────────────────────────────────────┐
          │  ACTIVE BANNER (amber, .bl-automate-active-banner)                │
          │                                                                   │
          │  span: "Active: Screen Share"                                     │
          │                                                                   │
          │  .bl-automate-banner-btns (flex row):                             │
          │                                                                   │
          │  if (triggers.screen_share && onClearScreenShareBlur):            │
          │  ┌────────────────────────────────────┐                          │
          │  │  [Stop Screen Share Blur] (sky)    │                          │
          │  │  .bl-automate-clear-btn--ss        │                          │
          │  │                                    │                          │
          │  │  onClick:                          │                          │
          │  │    onClearScreenShareBlur()         │                          │
          │  │      popup.js _onClearScreenShareBlur()                       │
          │  │        State.clearScreenShareBlur()                           │
          │  │          blsi.Model.save_automate_blur(                       │
          │  │            hostname, 'screen_share', false                    │
          │  │          )                                                     │
          │  │          refreshFromStorage()                                  │
          │  │        _renderCurrent()                                       │
          │  └────────────────────────────────────┘                          │
          │                                                                   │
          │  [Turn Off] (amber)                                               │
          │  .bl-automate-clear-btn                                           │
          │                                                                   │
          │  onClick:                                                         │
          │    onClearAutomate()                                              │
          │      popup.js _onClearAutomate()                                  │
          │        State.clearAutomateBlur()                                  │
          │          blsi.Model.clear_automate_blur(hostname)                 │
          │            ← deletes ENTIRE hostname entry from session           │
          │              (clears idle + tab_switch + screen_share at once)    │
          │          refreshFromStorage()                                      │
          │        _renderCurrent()                                           │
          └───────────────────────────────────────────────────────────────────┘
                 │
                 │  (below banner, always shown)
                 ▼
          ┌───────────────────────────────────────────────────────────────────┐
          │  Summary rows:                                                    │
          │   Idle        │ Off                                               │
          │   Tab Switch  │ Off                                               │
          │   Screen Share│ On                                                │
          └───────────────────────────────────────────────────────────────────┘

  When popup button action writes to session storage:
    chrome.storage.onChanged fires in content_script (all tabs)
      └─► handleStorageChange(newModel, oldModel)
            └─► Store.resolve() → settings updated
                └─► applyState(resolved, prev)
                      └─► Engine.handleSite(resolved)
                            └─► blur_all_active=false → DOM cleared
```

---

### 6h. Storage State Machine (2-Tab Scenario)

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║              STORAGE STATE MACHINE — 2-TAB SCENARIO (A=sharer, B=viewer)    ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  TIME ──────────────────────────────────────────────────────────────────────►

  EVENT                         chrome.storage.session values

                                blsi_screen_share_active  |  blsi_automate_blur
  ─────────────────────────────────────────────────────────────────────────────
  [Initial state]               false                     |  {}

  Tab A: getDisplayMedia()      ─────────────────────────────────────────────
    Port opens →                 true                     |  {}
    msg SCREEN_SHARE_STARTED →   true (redundant)         |  {}
    SCREEN_SHARE_BLUR → Tab B →  (Tab B handles below)    |

  Tab B: handles SCREEN_SHARE_BLUR
    save_automate_blur(B, 'screen_share', true)            |  { "B.host": { screen_share: true } }
    _sync() → blur DOM

  Tab B: user clicks "This site" in toast
    save_automate_blur(B, 'screen_share', false)           |  { "B.host": { screen_share: false } }
    _sync() → unblur DOM

  NEW share starts (Tab A shares again)
    SCREEN_SHARE_BLUR → Tab B (again)
    Tab B: save_automate_blur(B, 'screen_share', true)     |  { "B.host": { screen_share: true } }
    _sync() → blur DOM again
    (Note: "This site" only stopped the PREVIOUS blur session)

  Tab A: share ends (port disconnect)
    session.set({ blsi_screen_share_active: false })  |
    FAN-OUT SCREEN_SHARE_UNBLUR → Tab A, Tab B        |

  Tab B: handles SCREEN_SHARE_UNBLUR
    save_automate_blur(B, 'screen_share', false)           |  { "B.host": { screen_share: false } }
    _sync() → unblur DOM

  Tab A: handles SCREEN_SHARE_UNBLUR (Tab A also gets it)
    save_automate_blur(A, 'screen_share', false)           |  { "B.host": {...}, "A.host": {...} }
    _sync()                                                |  (A.host entry added if not present)

  Browser closes                false                     |  {} (session cleared by browser)

  ─────────────────────────────────────────────────────────────────────────────

  Key state transition rules:
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  blsi_screen_share_active   is a single boolean — global across tabs    │
  │  blsi_automate_blur         is per-hostname — independent per site       │
  │                                                                         │
  │  Tab A's "automate_blur" is also updated by SCREEN_SHARE_UNBLUR        │
  │  even though Tab A was never blurred (it was the sender, excluded       │
  │  from SCREEN_SHARE_BLUR fan-out). This is harmless — Tab A's            │
  │  screen_share automate_blur entry was never set to true anyway.         │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

### 6i. resolve() Computed Field Derivation

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                    storage_model.resolve() — COMPUTED FIELDS                 ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Inputs:
    _cache           — chrome.storage.local['blsi_model'] (persistent model)
    _automate_cache  — chrome.storage.session['blsi_automate_blur'] (session)
    hostname         — current tab's hostname (e.g. 'github.com')
    url              — full current URL (for wildcard/regex rule matching)

  ─────────────────────────────────────────────────────────────────────────────

  STEP 1: Read automate trigger state from _automate_cache

    automate_entry = _automate_cache[hostname]
                  ?? { idle: false, tab_switch: false, screen_share: false }

    automate_blur_active   = !!(automate_entry.idle
                               || automate_entry.tab_switch
                               || automate_entry.screen_share)

    automate_blur_triggers = {
      idle:         !!automate_entry.idle,
      tab_switch:   !!automate_entry.tab_switch,
      screen_share: !!automate_entry.screen_share,
    }

  ─────────────────────────────────────────────────────────────────────────────

  STEP 2: Determine manual blur state

    exact        = site_rules entry for exact hostname match (or null)
    manual_blur  = exact
                   ? (exact.blur_all !== null
                      ? !!exact.blur_all        ← site-specific override
                      : m.blur_all.status)       ← global default
                   : m.blur_all.status

    blur_present = manual_blur || m.pick_and_blur.status

  ─────────────────────────────────────────────────────────────────────────────

  STEP 3: Compute automate_blur_only and automate_blur_skipped

    automate_needs_blur  = automate_blur_active && !blur_present
     (automate is the      automate active, AND no manual/pick blur
      sole blur source)

    automate_blur_only   = !!automate_needs_blur
    automate_blur_skipped = automate_blur_active && !!blur_present

    ┌─────────────────────────────────────────────────────────────────────┐
    │  Truth table:                                                       │
    │                                                                     │
    │  automate_active | blur_present | only  | skipped | toast shown    │
    │  ────────────────────────────────────────────────────────────────   │
    │  false           | false        | false | false   | none           │
    │  false           | true         | false | false   | none           │
    │  true            | false        | true  | false   | 15s 3-action   │
    │  true            | true         | false | true    | 2.5s skipped   │
    └─────────────────────────────────────────────────────────────────────┘

  ─────────────────────────────────────────────────────────────────────────────

  STEP 4: Compute blur_all_active

    blur_all_active = manual_blur || automate_needs_blur

  ─────────────────────────────────────────────────────────────────────────────

  STEP 5: Override settings when automate_blur_only === true

    When automate is the SOLE blur source, user's custom settings
    (picked blur mode, radius, etc.) should NOT apply — default values used:

    if (automate_needs_blur):
      resolved.blur_mode           = DEFAULT_MODEL.blur_all.settings.blur_mode
      resolved.blur_categories     = DEFAULT_MODEL.blur_all.settings.blur_categories
      resolved.blur_radius         = DEFAULT_MODEL.global_default_settings.blur_radius
      resolved.thorough_blur       = DEFAULT_MODEL.global_default_settings.thorough_blur
      resolved.reveal_mode         = DEFAULT_MODEL.global_default_settings.reveal_mode
      resolved.transition_duration = DEFAULT_MODEL.global_default_settings.transition_duration
      resolved.redaction_color     = DEFAULT_MODEL.global_default_settings.redaction_color
      resolved.highlight_color     = DEFAULT_MODEL.global_default_settings.highlight_color

    Rationale: screen-share blur is an emergency privacy measure.
    It should always apply with safe defaults, regardless of how the
    user configured their normal blur-all appearance.

  ─────────────────────────────────────────────────────────────────────────────

  Output object (screen-share-relevant fields only):

    {
      // Feature config (from model.automate.settings)
      automate_screen_share: { enabled: boolean },

      // Trigger state (from _automate_cache)
      automate_blur_active:   boolean,
      automate_blur_triggers: { idle, tab_switch, screen_share },

      // Computed blur state
      blur_all_active:        boolean,
      automate_blur_only:     boolean,
      automate_blur_skipped:  boolean,

      // Settings (possibly overridden to defaults if automate_blur_only)
      blur_mode:              string,
      blur_categories:        object,
      blur_radius:            number,
      thorough_blur:          boolean,
      reveal_mode:            string,

      // Items (unaffected by automate)
      blur_items:             Array,

      // … 70+ other resolved fields
    }
```

---

### 6j. _sync() Call Chain

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                            _sync() CALL CHAIN                               ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  content_script.js

  async function _sync() {
    │
    ├─ Store.resolve(_topHostname, location.href)
    │     │
    │     ├─ Reads _cache         (local model, from storage init)
    │     ├─ Reads _automate_cache (session state, from storage init)
    │     ├─ Applies URL rule matching (wildcard/regex site_rules)
    │     ├─ Merges exact hostname override
    │     └─ Computes derived fields (blur_all_active, automate_blur_only, …)
    │     Returns: resolved (full settings snapshot)
    │
    ├─ settings = resolved          ← updates the outer `settings` variable
    │                                  used by the toast condition checks
    │
    ├─ applySettingsToDom(resolved)
    │     └─ Sets CSS custom properties on :root
    │           --bl-si-radius, --bl-si-transition, etc.
    │
    └─ await Engine.handleSite(resolved)
          │
          ├─ _handling = true   (mutex prevents concurrent calls)
          │
          ├─ If extension disabled:
          │    teardown(document) → remove CSS, unstamp, disconnect MO
          │    return
          │
          ├─ reconcileKey = `${blur_mode}|${categories}|${thorough}|…`
          │   if (reconcileKey !== _lastReconcileKey):
          │     ← page-wide settings changed
          │     handleMainDocument(resolved)
          │       │
          │       ├─ If blur_all_active:
          │       │    injectRules(document, categories, mode)
          │       │      ← injects <style id="bl-si-blur-styles"> into <head>
          │       │      ← CSS covers alwaysBlur selectors (tag + role based)
          │       │    stampElements(document, categories, thorough, mode)
          │       │      ← single querySelectorAll('*') pass
          │       │      ← stamps [data-bl-si-blur] on textCheck elements
          │       │      ← returns discovered ShadowRoot[]
          │       │    observeRoot(document)
          │       │      ← MutationObserver on document.body
          │       │      ← watches for new elements + new shadow hosts
          │       │
          │       └─ If !blur_all_active:
          │            teardown(document)
          │              ← removeRules + remove stamps + disconnect MO
          │
          ├─ _isPageBlurred = blur_all_active
          │
          ├─ _reconcileItems(blur_items)
          │    ← diff _activeItems Map against desired items
          │    ← applyItem() / removeItem() for changes
          │
          └─ _handling = false

  Callers of _sync() (screen-share-related):
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  SCREEN_SHARE_BLUR handler    (after save_automate_blur → true)          │
  │  SCREEN_SHARE_UNBLUR handler  (after save_automate_blur → false)         │
  │  Init catch-up path (9b)      (after save_automate_blur → true on init)  │
  │  "This tab" toast action      (after save_automate_blur → false + flag)  │
  │  "This site" toast action     (after save_automate_blur → false)         │
  │  "Disable" toast action       (after patch_section + save → false)       │
  │  handleStorageChange          (any storage change → re-resolve → _sync)  │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

### 6k. Toast DOM Structure

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║                         CONTENT TOAST — DOM STRUCTURE                       ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Injected into document.body by shortcut_handler.js showToast():

  ┌── div.bl-si-toast ────────────────────────────────────────────────────────┐
  │   role="status"  aria-live="polite"                                       │
  │   position:fixed  bottom:24px  right:24px  z-index:2147483646             │
  │   background:rgba(15,15,15,0.92)  backdrop-filter:blur(6px)               │
  │   display:flex  flex-direction:column  gap:8px  max-width:380px           │
  │   animation: bl-si-toast-in 200ms ease forwards                           │
  │   pointer-events:auto  (close + action buttons are clickable)             │
  │                                                                           │
  │   ┌── div.bl-si-toast__top ─────────────────────────────────────────────┐ │
  │   │   display:flex  align-items:center  gap:8px                         │ │
  │   │                                                                     │ │
  │   │   ┌── img.bl-si-toast__logo ─────────────────────────────────────┐ │ │
  │   │   │   src: chrome.runtime.getURL('icons/icon16.png')              │ │ │
  │   │   │   width:16px  height:16px  opacity:0.85  aria-hidden:true     │ │ │
  │   │   └─────────────────────────────────────────────────────────────── ┘ │ │
  │   │                                                                     │ │
  │   │   ┌── span.bl-si-toast__message ───────────────────────────────────┐ │ │
  │   │   │   "Blur applied — screen share active"                          │ │ │
  │   │   │   font-size:13px  color:#f3f4f6                                │ │ │
  │   │   └─────────────────────────────────────────────────────────────────┘ │ │
  │   │                                                                     │ │
  │   │   ┌── button.bl-si-toast__close ───────────────────────────────────┐ │ │
  │   │   │   "✕"  aria-label="Dismiss"                                    │ │ │
  │   │   │   onClick: _dismissToast(toast)                                │ │ │
  │   │   └─────────────────────────────────────────────────────────────────┘ │ │
  │   └─────────────────────────────────────────────────────────────────────┘ │
  │                                                                           │
  │   ┌── div.bl-si-toast__actions ─────────────────────────────────────────┐ │
  │   │   display:flex  gap:6px  flex-wrap:wrap  padding-left:24px           │ │
  │   │                                                                     │ │
  │   │   ┌── button.bl-si-toast__action ─────────────────────────────────┐ │ │
  │   │   │   "This tab"                                                   │ │ │
  │   │   │   color:#60a5fa  border:1px solid rgba(96,165,250,0.35)        │ │ │
  │   │   │   background:rgba(96,165,250,0.08)                             │ │ │
  │   │   │   onClick: _dismissToast(toast); action.onClick()              │ │ │
  │   │   └───────────────────────────────────────────────────────────────┘ │ │
  │   │                                                                     │ │
  │   │   ┌── button.bl-si-toast__action ─────────────────────────────────┐ │ │
  │   │   │   "This site"                                                  │ │ │
  │   │   │   (same blue styling as above)                                 │ │ │
  │   │   │   onClick: _dismissToast(toast); action.onClick()              │ │ │
  │   │   └───────────────────────────────────────────────────────────────┘ │ │
  │   │                                                                     │ │
  │   │   ┌── button.bl-si-toast__action.bl-si-toast__action--warn ────────┐ │ │
  │   │   │   "Disable"                                                    │ │ │
  │   │   │   color:#f59e0b  border:1px solid rgba(245,158,11,0.35)        │ │ │
  │   │   │   background:rgba(245,158,11,0.08)   (amber — warn variant)    │ │ │
  │   │   │   onClick: _dismissToast(toast); action.onClick()              │ │ │
  │   │   └───────────────────────────────────────────────────────────────┘ │ │
  │   └─────────────────────────────────────────────────────────────────────┘ │
  └───────────────────────────────────────────────────────────────────────────┘

  Auto-dismiss timer: setTimeout(_dismissToast, 15000)
  stored on toast._removeTimer so it can be cleared when close/action clicked.

  _dismissToast(toast):
    clearTimeout(toast._removeTimer)
    toast.classList.add('bl-si-toast--exiting')   ← triggers out animation
    setTimeout(() => {
      toast.parentNode.removeChild(toast)          ← DOM removal after 250ms
      if (currentToastEl === toast) currentToastEl = null
    }, 250)
```

---

### 6l. Full Interaction Sequence (Numbered)

```
  ╔══════════════════════════════════════════════════════════════════════════════╗
  ║              FULL NUMBERED SEQUENCE — SHARE START TO BLUR APPLIED            ║
  ╚══════════════════════════════════════════════════════════════════════════════╝

  Preconditions:
    · Tab A is on meet.example.com
    · Tab B is on github.com
    · Tab C is on docs.google.com
    · screen_share automate feature is enabled in all tabs
    · No manual blur is currently active on B or C

  ──  1  ── User clicks "Share screen" in the meeting app (Tab A)
            Browser shows screen picker dialog

  ──  2  ── User selects a window/screen and confirms

  ──  3  ── navigator.mediaDevices.getDisplayMedia() resolves with MediaStream
            (intercepted by main_world_bridge.js BEFORE returning to web app)

  ──  4  ── main_world_bridge.js: _dispatchScreenShare(true)
            document.dispatchEvent(new CustomEvent('__blsi_screen_share',
                                                   { detail: { active: true } }))

  ──  5  ── screen_share.js: CustomEvent listener fires (isolated world, Tab A)
            _handler({ detail: { active: true } })

  ──  6  ── screen_share.js: Opens Port
            _sharePort = chrome.runtime.connect({ name: 'blsi-screen-share' })

  ──  7  ── background.js: chrome.runtime.onConnect fires
            port.name === 'blsi-screen-share'  ✓
            tabId = port.sender.tab.id  (Tab A)
            _sharePorts.set(tabA, port)
            chrome.storage.session.set({ blsi_screen_share_active: true })
            port.onDisconnect listener registered

  ──  8  ── screen_share.js: Sends message (slightly after port open)
            chrome.runtime.sendMessage({ type: 'SCREEN_SHARE_STARTED' })

  ──  9  ── background.js: chrome.runtime.onMessage fires (SCREEN_SHARE_STARTED)
            chrome.storage.session.set({ blsi_screen_share_active: true })  [redundant]
            chrome.tabs.query({ url: ['http://*/*','https://*/*'] })

  ── 10  ── background.js: For each tab in result:
              Tab A (tabId === senderTabId) → SKIPPED
              Tab B → chrome.tabs.sendMessage(B, { type: 'SCREEN_SHARE_BLUR' })
              Tab C → chrome.tabs.sendMessage(C, { type: 'SCREEN_SHARE_BLUR' })
            sendResponse({ ok: true })

  ── 11  ── content_script.js (Tab B): handleMessage fires
            case blsi.command.screen_share_blur
            _ssBlurSuppressed === false  → continue
            am_s.screen_share.enabled === true  → continue

  ── 12  ── content_script.js (Tab B): async IIFE starts
            await Store.save_automate_blur('github.com', 'screen_share', true)
            → _automate_cache['github.com'].screen_share = true
            → chrome.storage.session['blsi_automate_blur'] =
                { 'github.com': { idle:false, tab_switch:false, screen_share:true } }

  ── 13  ── content_script.js (Tab B): await _sync()
            Store.resolve('github.com', 'https://github.com/...')
              automate_entry.screen_share === true
              automate_blur_active = true
              blur_present = false  (no manual blur)
              automate_needs_blur = true
              blur_all_active = true
              automate_blur_only = true
              Settings overridden to defaults

  ── 14  ── Engine.handleSite(resolved)  (Tab B)
            blur_all_active = true → page-wide changed
            handleMainDocument(resolved)
              injectRules(document, categories, 'blur')
                → <style id="bl-si-blur-styles"> injected in <head>
              stampElements(document, categories, thorough, 'blur')
                → querySelectorAll('*') pass
                → [data-bl-si-blur="1"] stamped on text/media/table/structure elements
              observeRoot(document)
                → MutationObserver watching document.body

  ── 15  ── settings.automate_blur_only === true  →  show toast
            Shortcuts.showToast(
              'Blur applied — screen share active',
              15000,
              _ssBlurStopActions()
            )

  ── 16  ── showToast creates:
            div.bl-si-toast { display:flex flex-direction:column }
              div.bl-si-toast__top
                img.bl-si-toast__logo (icon16.png, opacity 0.85)
                span.bl-si-toast__message ("Blur applied — screen share active")
                button.bl-si-toast__close ("✕")
              div.bl-si-toast__actions
                button.bl-si-toast__action ("This tab")
                button.bl-si-toast__action ("This site")
                button.bl-si-toast__action.--warn ("Disable")
            Appended to document.body (Tab B)
            setTimeout(_dismissToast, 15000) stored on toast._removeTimer

  ── 17  ── Same as steps 11–16 for Tab C (github.com → docs.google.com)

  ── 18  ── Tab B's github.com page is now blurred.
            Tab C's docs.google.com page is now blurred.
            Tab A (meet.example.com) is NOT blurred.
            Toasts visible in Tab B and Tab C for 15 seconds.

  ──────────────────────────────────────────────────────────────────────────────
  OPTIONAL: User clicks "This tab" toast button in Tab B at step t+5s
  ──────────────────────────────────────────────────────────────────────────────

  ── 19  ── _dismissToast(toast) called first
            toast.classList.add('bl-si-toast--exiting')
            setTimeout(removeChild, 250)

  ── 20  ── action.onClick() called
            _ssBlurSuppressed = true   (Tab B only, in-memory)
            await Store.save_automate_blur('github.com', 'screen_share', false)
            → session: { 'github.com': { screen_share: false } }

  ── 21  ── await _sync()  (Tab B)
            automate_entry.screen_share === false
            automate_blur_active = false
            blur_all_active = false
            Engine.handleSite → teardown → CSS removed, stamps cleared
            Tab B is now unblurred.

  ── 22  ── chrome.storage.onChanged fires in Tab C (session change from step 20)
            handleStorageChange → Store.resolve → applyState → _sync
            resolve: 'docs.google.com' has { screen_share: true } → UNCHANGED
            Tab C remains blurred.  ← "This tab" only affected Tab B's flag,
                                      but session change propagates everywhere.
                                      Tab C's hostname is different → its entry
                                      is unaffected. Tab C stays blurred.

  ── 23  ── New screen share starts in Tab A (second meeting)
            Steps 4–18 repeat.
            Tab B receives SCREEN_SHARE_BLUR.
            content_script.js: _ssBlurSuppressed === true → GUARD ① fires
            Tab B: sendResponse({ ok:false, reason:'tab-suppressed' }) → break
            Tab B: NOT blurred  ← "This tab" suppression persists for lifetime of tab
```

---

## 7. Data Shapes — Complete Reference

### 7a. _ssBlurStopActions() — Return Value

```javascript
// Called in: content_script.js (inside IIFE, closures over Store, hostname, _sync)
function _ssBlurStopActions() {
  return [
    // ── Action 0: This tab ───────────────────────────────────────────────
    {
      label:   chrome.i18n.getMessage('automate_stop_per_tab'),  // "This tab"
      variant: undefined,   // default blue styling
      onClick: async () => {
        _ssBlurSuppressed = true;
        //    ↑ In-memory. Blocks future SCREEN_SHARE_BLUR to this tab.
        await Store.save_automate_blur(hostname, 'screen_share', false);
        //    ↑ Writes session storage. Unblurs this tab via _sync.
        await _sync();
        //    ↑ Re-resolves. blur_all_active=false. DOM cleared.
      },
    },

    // ── Action 1: This site ──────────────────────────────────────────────
    {
      label:   chrome.i18n.getMessage('automate_stop_per_domain'), // "This site"
      variant: undefined,   // default blue styling
      onClick: async () => {
        await Store.save_automate_blur(hostname, 'screen_share', false);
        //    ↑ Writes session storage. All tabs on this hostname will see
        //      onChanged and re-sync (clear blur if no other trigger active).
        await _sync();
      },
    },

    // ── Action 2: Disable ────────────────────────────────────────────────
    {
      label:   chrome.i18n.getMessage('automate_disable_feature'), // "Disable"
      variant: 'warn',   // amber styling — indicates stronger/persistent action
      onClick: async () => {
        await Store.patch_section('automate', {
          settings: { screen_share: { enabled: false } },
          //    ↑ Writes to chrome.storage.local (persistent).
          //      All tabs see onChanged → handleStorageChange → applyState.
          //      screen_share.init() will NOT be called → feature disabled.
        });
        await Store.save_automate_blur(hostname, 'screen_share', false);
        //    ↑ Clear current session trigger state too.
        await _sync();
      },
    },
  ];
}
```

### 7b. showToast() Parameter Shape

```javascript
// shortcut_handler.js
showToast(
  text:    string,          // visible message text (already i18n resolved)
  duration?: number,        // ms before auto-dismiss (default: 15000)
  actions?: Array<{         // optional action buttons in second row
    label:    string,       // button text
    onClick:  function,     // called AFTER _dismissToast (toast already gone)
    variant?: 'warn',       // 'warn' = amber; absent = blue (default)
  }>
)
```

### 7c. chrome.storage.session shape during active share

```javascript
// Full session storage snapshot while github.com is being blurred
// due to screen share from another tab:

chrome.storage.session = {
  blsi_screen_share_active: true,
  blsi_automate_blur: {
    "github.com": {
      idle:         false,
      tab_switch:   false,
      screen_share: true,   // ← set by SCREEN_SHARE_BLUR handler
    }
  }
}
```

### 7d. resolved settings subset (screen-share fields)

```javascript
// Object returned by Store.resolve(hostname, url) — screen-share-relevant fields:
{
  // Feature config
  automate_screen_share: {
    enabled: true,       // user's global on/off toggle from popup
  },

  // Trigger state (from _automate_cache, not from model)
  automate_blur_active:   true,
  automate_blur_triggers: {
    idle:         false,
    tab_switch:   false,
    screen_share: true,
  },

  // Derived blur control
  blur_all_active:        true,   // manual_blur OR automate_needs_blur
  automate_blur_only:     true,   // automate is the ONLY active blur source
  automate_blur_skipped:  false,  // would be true if manual blur was already on

  // Settings (overridden to defaults because automate_blur_only=true)
  blur_mode:           'blur',    // DEFAULT_MODEL value (not user's pick)
  blur_radius:         8,         // DEFAULT_MODEL value
  thorough_blur:       false,     // DEFAULT_MODEL value
  reveal_mode:         'hover',   // DEFAULT_MODEL value
  transition_duration: 0,         // DEFAULT_MODEL value
  redaction_color:     '#000000', // DEFAULT_MODEL value

  // Items
  blur_items: [],    // pick-blur items are irrelevant when automate_blur_only
}
```

---

## 8. i18n Key Reference

All keys from `_locales/en/messages.json` used in the screen share flow:

| Key | English value | Used in |
|-----|--------------|---------|
| `automate_screen_share` | "Screen Share" | Popup automate banner label, popup summary row label |
| `automate_triggered_by` | "Active:" | Popup automate banner prefix |
| `automate_turn_off` | "Turn Off" | Popup automate banner button (clear all triggers) |
| `automate_stop_screen_share` | "Stop Screen Share Blur" | Popup automate banner button (screen-share-only) |
| `automate_stop_per_tab` | "This tab" | Content toast action button (action 0) |
| `automate_stop_per_domain` | "This site" | Content toast action button (action 1) |
| `automate_disable_feature` | "Disable" | Content toast action button (action 2, warn) |
| `automate_toast_screen_share` | "Blur applied — screen share active" | Content toast message text |
| `automate_toast_skipped` | "Blur already active — automate skipped" | Content toast (skipped path, 2.5s) |
| `automate_on` | "On" | Popup automate summary row value |
| `automate_off` | "Off" | Popup automate summary row value |
| `automate_footer` | "When triggered → applies current blur mode settings" | Popup automate sub-page footer |

---

## 9. CSS Reference

### 9a. Content Toast Classes (styles/content.css)

| Class | Applied to | Purpose |
|-------|-----------|---------|
| `.bl-si-toast` | container `div` | Fixed bottom-right pill; flex-column; dark bg; 200ms slide-in |
| `.bl-si-toast--exiting` | container `div` | Triggers slide-out animation; added by `_dismissToast` |
| `.bl-si-toast__top` | inner `div` | Flex row for logo + message + close button |
| `.bl-si-toast__logo` | `img` | 16px icon; opacity 0.85 |
| `.bl-si-toast__message` | `span` | Message text; 13px; #f3f4f6 |
| `.bl-si-toast__actions` | inner `div` | Flex row for action buttons; padding-left:24px |
| `.bl-si-toast__action` | `button` | Blue action button; 11.5px; pointer-events:auto |
| `.bl-si-toast__action--warn` | `button` (modifier) | Amber variant for destructive actions |
| `.bl-si-toast__close` | `button` | Muted ✕ button; pointer-events:auto |

### 9b. Popup Automate Banner Classes (popup/renders/automate.css)

| Class | Applied to | Purpose |
|-------|-----------|---------|
| `.bl-automate-active-banner` | `div` | Amber banner shown when any trigger active; flex-column |
| `.bl-automate-banner-btns` | `div` | Flex row for action buttons inside banner |
| `.bl-automate-clear-btn` | `button` | Amber stop button; generic style |
| `.bl-automate-clear-btn--ss` | `button` (modifier) | Sky-blue variant for screen-share-specific stop |

### 9c. Animation Keyframes

```css
/* Entry: slide up + scale in */
@keyframes bl-si-toast-in {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}

/* Exit: slide down + scale out (triggered by --exiting class) */
@keyframes bl-si-toast-out {
  from { opacity: 1; transform: translateY(0)   scale(1);    }
  to   { opacity: 0; transform: translateY(6px) scale(0.96); }
}
```

---

## 10. Edge Cases & Known Complexities

### 10a. Double Fan-Out on Normal Share End

```
When a share ends normally, BOTH paths A (port disconnect) AND B (SCREEN_SHARE_ENDED
message) fire. This means every tab receives SCREEN_SHARE_UNBLUR twice.

Why this is intentional:
  · Port disconnect is the safety net for crashes/navigation (PATH A).
  · SCREEN_SHARE_ENDED is the clean signal for normal share end (PATH B).
  · The UNBLUR handler is idempotent:
      save_automate_blur(host, 'screen_share', false)
      ← calling this when already false is a no-op (sets false → false).
      _sync() detects no state change and engine does minimal work.

Downside: two storage.onChanged events fire per tab. Negligible in practice.
```

### 10b. Self-Echo Guard in storage_model.js

```
storage_model.js modifies chrome.storage.session in save_automate_blur().
chrome.storage.onChanged then fires in the same context that wrote it.
Without a guard, this would trigger handleStorageChange() → _sync() → infinite loop.

Guard implementation:
  1. Before writing session storage, update _automate_cache synchronously.
  2. In storage.onChanged handler: if (_deep_equal(_automate_cache, newValue)) return;
  3. Self-writes are filtered because _automate_cache already reflects the new value.

Cross-tab writes (from another tab's content_script) will NOT match _automate_cache
→ onChanged propagates → handleStorageChange fires → re-sync happens correctly.
```

### 10c. Sharing Tab Is Never Blurred (By Design)

```
In background.js SCREEN_SHARE_STARTED fan-out (line ~196):
  if (tab.id !== senderTabId)   ← SKIP the sharing tab

The sharing tab (Tab A) does NOT receive SCREEN_SHARE_BLUR.
Rationale: the sharer needs to see their own screen to navigate during the share.

HOWEVER: Tab A does receive SCREEN_SHARE_UNBLUR when the share ends.
Tab A's UNBLUR handler runs save_automate_blur(hostname, 'screen_share', false) +
_sync(). This is a no-op (Tab A's screen_share was never true), but it executes.
```

### 10d. _ssBlurSuppressed Does Not Affect automate_blur_skipped Path

```
_ssBlurSuppressed guards only the SCREEN_SHARE_BLUR message handler.

If automate_blur_skipped fires (manual blur was already active when SCREEN_SHARE_BLUR
arrived), the handler shows the "already active" toast and returns without
calling save_automate_blur. The skipped path does not reach the _ssBlurSuppressed
check (it's checked before the enabled check, both before the async IIFE).

In practice: if _ssBlurSuppressed is true, the message is dropped entirely at
guard ①, before any path (blur or skip) executes. So the flag suppresses both.
```

### 10e. automate_blur_only vs automate_blur_skipped — Mutual Exclusion

```
automate_blur_only    = automate_active && !blur_present
automate_blur_skipped = automate_active &&  blur_present

These are logically mutually exclusive (can't be both true at the same time).

  automate_blur_only   === true  → 15-second toast with 3 action buttons
  automate_blur_skipped === true → 2.5-second "already active" toast (no actions)
  both === false                 → no toast (automate not active)

When automate_blur_only is false (manual blur was already on), the user already
controls blur via the popup toggle — the automate toast would be redundant.
```

### 10f. SPA Navigation Does Not Reset _ssBlurSuppressed

```
_ssBlurSuppressed is declared inside the content_script IIFE:
  let _ssBlurSuppressed = false;

For normal navigations, Chrome unloads the content script entirely and re-injects
it on the new page → fresh execution → _ssBlurSuppressed = false.

For SPA navigation (pushState/replaceState/hashchange), the content script is NOT
reloaded. The URL change is detected by content_script's SPA URL watcher, which
calls onUrlChange() → _sync(). BUT _ssBlurSuppressed is NOT reset on SPA nav.

Impact: if a user is on github.com/foo, clicks "This tab" to suppress blur,
then SPA-navigates to github.com/bar, they remain suppressed on the same tab.
This is acceptable — the user explicitly said "don't blur this tab."
```

### 10g. New Tab Catch-Up Checks Both Conditions

```
Init step 9b checks:
  1. ss.blsi_screen_share_active   ← session flag (set by background on share start)
  2. screen_share_cfg.enabled      ← user's feature toggle (from local model)

Both must be true to trigger catch-up blur.

If the user clicked "Disable" in the toast on another tab:
  → screen_share_cfg.enabled becomes false (local storage, all tabs see it)
  → New tab catch-up: condition 2 fails → NOT blurred ✓

If the user clicked "This site" on another tab (same hostname):
  → session already has screen_share:false for this hostname
  → BUT step 9b writes screen_share:true anyway (it sets it without checking)
  → THEN _sync() runs, and save_automate_blur wrote true...
  → BUT "This site" only cleared THIS hostname's entry; the global session flag
     blsi_screen_share_active is still true (only cleared when share ends).
  → Result: the new tab WILL be blurred, then can suppress via its own toast.
  → This is acceptable: "This site" stops the current blur, not future ones.
```

### 10h. Service Worker Restart Races

```
Chrome can terminate a service worker at any time (idle timeout ~30s).
If the SW restarts mid-share:
  · _sharePorts Map is empty (in-memory, not persisted)
  · Port from screen_share.js is disconnected (SW terminated = port dead)
  · port.onDisconnect fires? NO — SW is dead, can't handle it.

What saves us:
  · background.js startup: chrome.storage.session.set({ blsi_screen_share_active: false })
  · Future SCREEN_SHARE_STARTED messages (if tab reloads or new share) will reconnect.
  · Existing blurred tabs: their automate_blur session state persists.
    They remain blurred until share ends (or browser restart clears session).
  · When share actually ends: screen_share.js calls sendMessage(SCREEN_SHARE_ENDED).
    This wakes the SW. SW fans out UNBLUR. All tabs cleared.

Worst case: SW dies, share ends, but screen_share.js port disconnect is missed.
  screen_share.js sends SCREEN_SHARE_ENDED message.
  SW wakes → clears flag → fans out UNBLUR → all tabs cleared.
  Result: clean cleanup via PATH B (sendMessage is the reliable fallback).
```

---

*End of document. Last updated with: toast redesign (15s + logo + close + 3 action buttons), screen share disable options (This tab / This site / Disable), popup automate banner with sky-blue screen-share-specific stop button.*
