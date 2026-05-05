# Screen Share Internals: (Operating System) OS → Browser → (Web Real-Time Communication) WebRTC → Extension

Technical reference for how screen sharing works end-to-end, what signals are
observable at each layer, and which ones our MAIN-world bridge can rely on.

---

## 1. OS-Level Capture

### macOS

**ScreenCaptureKit (macOS 12.3+)** — the modern API Chrome/Firefox use:

```
┌─────────────────────────────────────────────────────────┐
│  SCShareableContent                                     │
│  (enumerates windows, displays, running apps)           │
│       │                                                 │
│       ▼                                                 │
│  SCContentFilter        SCStreamConfiguration           │
│  (what to capture)      (resolution, fps, format)       │
│       │                       │                         │
│       └───────┬───────────────┘                         │
│               ▼                                         │
│          SCStream                                       │
│    startCapture() / stopCapture()                       │
│               │                                         │
│               ▼                                         │
│     SCStreamOutput delegate                             │
│     (CMSampleBuffer frames → browser)                   │
└─────────────────────────────────────────────────────────┘
```

**macOS 14+ (Sonoma):** `SCContentSharingPicker` — system-level picker that
bypasses TCC (Transparency, Consent, Control) permission. User selects a
surface through the OS picker; framework grants per-surface access only.

**Legacy (deprecated macOS 14, removed macOS 15):**
`CGWindowListCreateImage`, `CGDisplayStream` — synchronous pixel capture.
Still used by older browser versions.

**TCC Permission Model:**
- Screen Recording permission stored in
  `~/Library/Group Containers/group.com.apple.replayd/ScreenCaptureApprovals.plist`
- macOS 15 (Sequoia): monthly re-prompt for apps without
  `com.apple.security.persistent-content-capture` entitlement (Apple-only)

**macOS "Stop Sharing" button:**
OS terminates the `SCStream` → framework delivers stream error/ended callback →
browser process detects capture device loss → propagates to renderer →
`MediaStreamTrack.readyState` → `'ended'` + `ended` **event fires**.

### Windows

**Two APIs, both used by browsers:**

| API | Introduced | User Consent | GPU Affinity | Capture Level |
|-----|-----------|-------------|-------------|---------------|
| (DirectX Graphics Infrastructure) DXGI Desktop Duplication | Win 8 | None | Same (Graphics Processing Unit) GPU only | Full display |
| (Windows Graphics Capture) WGC | Win 10 1903 | System picker | Cross-GPU | Window or display |

**Windows.Graphics.Capture flow:**
`GraphicsCapturePicker` → user selects surface → `GraphicsCaptureItem` →
`CaptureSession` → Direct3D frame pool → browser.

**Windows "Stop Sharing":**
Same as macOS — OS terminates the capture session at the platform level,
browser detects device loss, propagates to renderer.

---

## 2. Browser Capture Pipeline (Chromium)

All hardware/OS capture runs in the **Browser process** (security sandbox).
Renderer processes request capture via (Inter-Process Communication) IPC.

```
┌──────────────────────── BROWSER PROCESS ────────────────────────┐
│                                                                  │
│  MediaStreamManager (MSM)                                        │
│  ├── manages permissions via MediaStreamUI                       │
│  └── creates:                                                    │
│                                                                  │
│  VideoCaptureDeviceFactory (VCDF)                                │
│  └── instantiates platform-specific VCD:                         │
│      ├── macOS: ScreenCaptureKit → SCStream                     │
│      ├── Windows: DXGI or WGC                                   │
│      └── Linux: PipeWire (Wayland) or X11                       │
│                                                                  │
│  VideoCaptureDevice (VCD) ──→ raw frames                        │
│       │                                                          │
│       ▼                                                          │
│  VideoCaptureDeviceClient (VCDC)                                 │
│  (pixel format → (Luminance+Chrominance) YUV420, rotation, size) │
│       │                                                          │
│       ▼                                                          │
│  VideoCaptureBufferPool (VCBP)                                   │
│  (shared memory buffers, recycled after client release)          │
│       │                                                          │
│       ▼                                                          │
│  VideoCaptureController (VCC)                                    │
│       │                                                          │
│       ▼                                                          │
│  VideoCaptureHost (VCH) ──── IPC ──→ Renderer                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────── RENDERER PROCESS ───────────────────────┐
│                                                                  │
│  VCH (IPC endpoint)                                              │
│       │                                                          │
│       ▼                                                          │
│  MediaStreamVideoSource                                          │
│       │                                                          │
│       ▼                                                          │
│  MediaStreamTrack (JS-visible object)                            │
│       │                                                          │
│       ▼                                                          │
│  [Page JS: getDisplayMedia() promise resolves with stream]       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Chrome's "Stop Sharing" Bar

The sharing indicator bar is tied to the **capture device lifecycle** in the
browser process — not to `track.readyState`. When user clicks "Stop sharing":

1. Browser process signals the `VideoCaptureDevice` to stop
2. VCD destroyed → propagates through VCC → VCH → IPC → Renderer
3. Renderer transitions `track.readyState` from `'live'` to `'ended'`
4. **`ended` event fires** on the `MediaStreamTrack` (browser-initiated)
5. Sharing indicator disappears

### Firefox

- macOS/Windows: uses same OS APIs as Chrome
- Linux (Wayland): PipeWire via `xdg-desktop-portal` (system dialog)
- Linux (X11): direct X11 screen capture

---

## 3. Our Interception: How BlurrySite Detects Screen Share

### The Technique: Monkey-Patching `getDisplayMedia`

We replace `navigator.mediaDevices.getDisplayMedia` with an `async function`
wrapper in the page's MAIN world, before any page script runs.

```
manifest.json:
  content_scripts: [{
    js: ["src/main_world_bridge.js"],
    run_at: "document_start",     ← runs before ANY page JS
    world: "MAIN",                ← page's own JS context (not isolated)
    all_frames: false             ← main frame only (!! see risks below)
  }]
```

**Start detection flow:**

```
┌─────────────────────── MAIN WORLD (page context) ───────────────────────┐
│                                                                          │
│  main_world_bridge.js (document_start, before page JS)                   │
│                                                                          │
│  1. Capture original:                                                    │
│     _origGetDisplayMedia = navigator.mediaDevices                        │
│                              .getDisplayMedia.bind(navigator.mediaDevices)│
│                                                                          │
│  2. Replace with wrapper:                                                │
│     navigator.mediaDevices.getDisplayMedia = async function (constraints) │
│                                                                          │
│  3. When page (Meet/Zoom/etc.) calls getDisplayMedia():                  │
│     a. wrapper calls _origGetDisplayMedia(constraints)                   │
│     b. Chrome shows picker dialog → user selects surface                 │
│     c. Promise resolves with MediaStream                                 │
│     d. wrapper calls _dispatchScreenShare(true)                          │
│           └→ window.postMessage({ type: '__blsi_screen_share',           │
│                                   active: true }, '*')                   │
│     e. wrapper hooks track lifecycle listeners                           │
│     f. wrapper returns stream to page (same object, unmodified)          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
            │ postMessage crosses world boundary
            ▼
┌──────────────── ISOLATED WORLD (extension context) ─────────────────────┐
│                                                                          │
│  src/automate/screen_share.js                                            │
│                                                                          │
│  window.addEventListener('message', handler)                             │
│  handler receives { type: '__blsi_screen_share', active: true }          │
│                                                                          │
│  1. Opens persistent port:                                               │
│     _sharePort = chrome.runtime.connect({ name: 'blsi-screen-share' })   │
│     (crash-safety: if tab closes, port disconnects → background cleans)  │
│                                                                          │
│  2. Sends message:                                                       │
│     chrome.runtime.sendMessage({ type: 'SCREEN_SHARE_STARTED' })         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
            │ chrome.runtime IPC
            ▼
┌──────────────────── BACKGROUND SERVICE WORKER ──────────────────────────┐
│                                                                          │
│  src/automate/screen_share_bg.js                                         │
│                                                                          │
│  1. State.set_screen_share_active(senderTabId)                           │
│     → session storage: blsi_screen_share[tabId] =                        │
│       { started_at: Date.now(), suppressed_sites: [] }                   │
│                                                                          │
│  2. _broadcastScreenShareNotify(senderTabId)                             │
│     → chrome.tabs.sendMessage to ALL tabs except sharing tab             │
│     → type: 'SCREEN_SHARE_NOTIFY'                                       │
│                                                                          │
│  3. Port lifecycle (crash safety):                                       │
│     port.onDisconnect → State.set_screen_share_inactive(tabId)           │
│     (handles tab close, extension update, crash — no orphan shares)      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
            │ chrome.tabs.sendMessage
            ▼
┌──────────────────── CONTENT SCRIPTS (all tabs) ─────────────────────────┐
│                                                                          │
│  content_script.js receives SCREEN_SHARE_NOTIFY                          │
│                                                                          │
│  1. await _sync()                                                        │
│     → Store.resolve_settings(hostname, url, tabId)                       │
│     → resolve_automate computes:                                         │
│        ss_eff = active                                                   │
│              && tab_id NOT in _sharing_tab_ids  (don't blur sharing tab) │
│              && host NOT in suppressed_sites                              │
│              && screen_share.enabled                                      │
│              && !tab_suppressed                                           │
│                                                                          │
│  2. Engine.handleSite(resolved) → automate overlay activates on tab      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Consequences of Patching `getDisplayMedia`

#### 3a. Fingerprinting / Detection by the Page

The patch is **detectable** by any page that looks for it:

| Detection method | What page sees | Risk |
|-----------------|----------------|------|
| `navigator.mediaDevices.getDisplayMedia.toString()` | Full source of our `async function` (native returns `"function getDisplayMedia() { [native code] }"`) | High — trivial single-line check |
| `Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getDisplayMedia')` | Returns a descriptor (native: `undefined`, since it's inherited from prototype) | High — our patch creates an own property shadowing the prototype |
| Compare with iframe reference | Same-origin iframe has unpatched reference (`all_frames: false`) | Medium — page can compare `iframe.contentWindow.navigator.mediaDevices.getDisplayMedia !== navigator.mediaDevices.getDisplayMedia` |

**Practical risk:** Low. Anti-bot systems focus on `navigator.webdriver`, Canvas,
(Web Graphics Library) WebGL fingerprints. No known site checks for MediaDevices patches. (Digital Rights Management) DRM streaming
sites are the most likely candidates but they use (Encrypted Media Extensions) EME, not `getDisplayMedia`.

#### 3b. Prototype Bypass (Unpatched Path)

Our patch assigns to the **instance** (`navigator.mediaDevices.getDisplayMedia`),
which shadows the **prototype** method. A page can bypass our wrapper:

```js
// Any of these call the NATIVE function directly, bypassing our hook:
MediaDevices.prototype.getDisplayMedia.call(navigator.mediaDevices, constraints);
navigator.mediaDevices.__proto__.getDisplayMedia.call(navigator.mediaDevices, constraints);
Object.getPrototypeOf(navigator.mediaDevices).getDisplayMedia.call(navigator.mediaDevices, constraints);
```

**Impact:** If Meet or any app uses prototype access, we miss the share entirely.
No known app does this today, but it's a single-line bypass.

**Mitigation (not implemented):** Also patch `MediaDevices.prototype.getDisplayMedia`.

#### 3c. iframe Bypass

```
manifest.json: all_frames: false
```

Our MAIN world script only runs in the **top frame**. If a same-origin iframe
calls `getDisplayMedia`, we miss it. The iframe's `navigator.mediaDevices` is
its own unpatched instance.

**Impact:** Google Meet embeds content in iframes but calls `getDisplayMedia`
from the top frame. No known app calls it from an iframe. Cross-origin iframes
get their own content script via `all_frames: true` on the isolated-world entry,
but they don't get the MAIN world bridge.

**Mitigation (not implemented):** Set `all_frames: true` for the MAIN world entry.
Trade-off: more JS execution on page load (every iframe gets the patch).

#### 3d. Async Wrapper Timing

The `async function` wrapper introduces **one extra microtask tick** (V8's
optimized await, Chrome 72+). Since `getDisplayMedia` involves seconds of user
interaction with the picker dialog, this is unmeasurable.

**Error propagation is correct:** If the user cancels the picker, the native
call rejects with `NotAllowedError`. The `await` propagates this — our
post-await code (track listeners, `_dispatchScreenShare(true)`) never executes.

```
Page calls getDisplayMedia()
  → our async wrapper starts
    → await _origGetDisplayMedia(constraints)
      → Chrome shows picker
      → User cancels → NotAllowedError rejects
    → await propagates rejection
  → Page's .catch() / try-catch receives NotAllowedError
  (our track hooks never run — correct behavior)
```

#### 3e. Patch Ordering with Other Extensions

Chrome does **not guarantee execution order** of MAIN world `document_start`
scripts across extensions (tracked: W3C WebExtensions issue #872).

If another extension also patches `getDisplayMedia`:

```
Extension A patches first:  native → A_wrapper
Extension B patches second: A_wrapper → B_wrapper → A_wrapper → native
```

Chaining works transparently because each wrapper calls what it captured as
"original". Our wrapper returns the stream unmodified, so downstream wrappers
see the correct object. The only risk: another extension transforms the stream
object before we see it (no known extension does this).

#### 3f. Multiple Concurrent Shares

Each `getDisplayMedia` call creates its own closure with its own `tracks`,
`pending`, and `done` variables. No shared mutable state between calls.

**Edge case:** If two shares are active and one ends, that closure's `pending`
hits 0 and dispatches `active: false` — even though the other share continues.
The background's per-tab port map handles this correctly: each share is tracked
by its tab's port, and only the ending tab's session entry is removed.

#### 3g. Stream Object Integrity

The wrapper returns the **same stream object** — no proxy, no clone. All
properties and methods are preserved. Our `addEventListener` calls on the
stream/tracks do not interfere with the page's own listeners (we don't call
`stopPropagation` or modify events).

**Memory:** Event listeners persist until the track/stream is (Garbage Collected) GC'd. Screen
shares are short-lived, so this is negligible. Using `{ once: true }` on
the `ended` listener would auto-clean but complicates the `pending` counter.

#### 3h. Where the Patch Cannot Reach

| Context | `getDisplayMedia` available? | Patched? | Notes |
|---------|------------------------------|----------|-------|
| Top frame (MAIN world) | Yes | **Yes** | Our script runs here |
| Same-origin iframe | Yes | **No** | `all_frames: false` |
| Cross-origin iframe | Yes | **No** | Separate JS context |
| Web Worker | No | N/A | API not available |
| Service Worker | No | N/A | API not available |
| Shared Worker | No | N/A | API not available |
| `blob:` URL iframe | Yes | **No** | May not match `<all_urls>` |

#### 3i. Browser Compatibility

| Browser | MAIN world scripts | Our bridge works? |
|---------|-------------------|-------------------|
| Chrome 111+ | `world: "MAIN"` in manifest | Yes |
| Firefox 128+ | `world: "MAIN"` added July 2024 | Yes |
| Safari 18 | **Not supported** | No — would need `<script>` injection (blocked by strict CSP) |

#### 3j. CSP (Content Security Policy) Safety

MAIN world scripts declared in `manifest.json` are injected by Chrome directly
into the page context — they are **not** `<script>` elements and do **not**
trigger `script-src` CSP checks. Our code uses no `eval()`, `Function()`, or
dynamic script creation, so no CSP violations occur.

---

## 4. MediaStreamTrack — Complete API Reference

### Properties

| Property | Type | R/W | Description |
|----------|------|-----|-------------|
| `id` | string | R | Unique (Globally Unique Identifier) GUID |
| `kind` | string | R | `'audio'` or `'video'` |
| `label` | string | R | User-agent source label |
| `readyState` | string | R | `'live'` or `'ended'` (only two states) |
| `enabled` | boolean | **RW** | App-level mute. **No event fires. Does NOT turn off capture.** |
| `muted` | boolean | R | Source temporarily unable to provide data |
| `contentHint` | string | RW | `''` / `'motion'` / `'detail'` / `'text'` (video) |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `stop()` | void | **Permanently ends track.** Sets `readyState` to `'ended'`. |
| `clone()` | MediaStreamTrack | Independent copy (own `readyState` lifecycle) |
| `getCapabilities()` | object | Supported value ranges for constrainable properties |
| `getConstraints()` | object | Currently applied constraints |
| `getSettings()` | object | **Actual current values** (resolution, fps, displaySurface, cursor) |
| `applyConstraints(c)` | Promise | Apply new constraints; rejects with `OverconstrainedError` |

**Display-capture-specific settings** (from `getSettings()`):

| Setting | Values | Notes |
|---------|--------|-------|
| `displaySurface` | `'monitor'` / `'window'` / `'browser'` | What user selected to share |
| `cursor` | `'always'` / `'motion'` / `'never'` | Cursor rendering mode |
| `logicalSurface` | boolean | — |
| `suppressLocalAudioPlayback` | boolean | Tab audio suppression |

### Events

| Event | Fires when | Does NOT fire when |
|-------|-----------|-------------------|
| **`ended`** | Source externally terminated: OS stop, permission revoked, shared window closed, hardware removed | **`track.stop()` called from JS** (per W3C spec) |
| `mute` | Source temporarily unavailable: window minimized, tab hidden, cursor idle | Track stopped or ended |
| `unmute` | Source recovers from muted state | — |

### The Critical Spec Detail

```
┌─────────────────────────────────────────────────────────────┐
│  track.stop()  →  readyState becomes 'ended'                │
│                   BUT 'ended' EVENT DOES NOT FIRE            │
│                                                              │
│  OS/browser terminates source  →  readyState becomes 'ended' │
│                                   AND 'ended' EVENT FIRES    │
└─────────────────────────────────────────────────────────────┘
```

**W3C Media Capture spec, §4.3.4:**
> When a MediaStreamTrack track is stopped by the script calling `stop()`,
> the user agent MUST queue a task to set track's readyState to "ended".
> [No `ended` event is specified for this path.]

> When a track is ended for other reasons (source disconnected, etc.),
> the user agent MUST fire an event named "ended".

This is the root cause of the bug. If Google Meet calls `track.stop()`, the
track becomes `'ended'` but the `ended` event never fires.

---

## 5. MediaStream — Complete API Reference

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique GUID (see §4 for expansion) |
| `active` | boolean | `true` when ≥1 track has `readyState === 'live'` |

### Methods

| Method | Description |
|--------|-------------|
| `addTrack(track)` | Add track to stream (**does NOT fire `addtrack` event**) |
| `removeTrack(track)` | Remove track from stream (**does NOT fire `removetrack` event**) |
| `getAudioTracks()` | Returns audio tracks array |
| `getVideoTracks()` | Returns video tracks array |
| `getTracks()` | Returns all tracks array |
| `getTrackById(id)` | Returns track or `null` |
| `clone()` | Deep clone (clones all tracks) |

### Events

| Event | Fires when | Does NOT fire when |
|-------|-----------|-------------------|
| `addtrack` | **User agent** adds a track (e.g. WebRTC renegotiation) | App calls `stream.addTrack()` |
| `removetrack` | **User agent** removes a track | App calls `stream.removeTrack()` |
| `active` | Stream goes from inactive → active (≥1 live track) | — |
| `inactive` | Stream goes from active → inactive (0 live tracks) | — |

### The Second Critical Spec Detail

```
┌─────────────────────────────────────────────────────────────┐
│  stream.addTrack(t)     →  track added, NO 'addtrack' event │
│  stream.removeTrack(t)  →  track removed, NO 'removetrack'  │
│                                                              │
│  User agent adds/removes →  event DOES fire                  │
└─────────────────────────────────────────────────────────────┘
```

App-initiated `addTrack()`/`removeTrack()` are silent. Only user-agent-
initiated changes fire events. This means listening for `removetrack` on
the stream does NOT catch an app calling `stream.removeTrack(track)`.

---

## 6. What Happens When "Stop Presenting" is Clicked

### (Real-Time Communication Peer Connection) RTCPeerConnection track management

Web conferencing apps use three approaches to stop sharing a track:

| Method | renegotiation? | `ended` event? | stream `inactive`? | Notes |
|--------|---------------|----------------|---------------------|-------|
| `track.stop()` | No | **NO** (spec) | **YES** (readyState → ended → stream inactive) | Most common approach |
| `sender.replaceTrack(null)` | No | No | No (track still alive, just not sent) | Preferred by apps — keeps sender slot |
| `pc.removeTrack(sender)` | Yes (`negotiationneeded`) | No | No | Heavy — changes (Session Description Protocol) SDP |

### Google Meet (most likely behavior)

```
User clicks "Stop presenting"
       │
       ▼
Meet JS calls track.stop()  ──→  readyState = 'ended'
       │                         (NO 'ended' event per spec)
       │
       ▼
Meet calls sender.replaceTrack(null) or pc.removeTrack(sender)
       │
       ▼
Meet's own UI updates, signals peers via data channel / (Session Initiation Protocol) SIP
```

**Why macOS native stop works:** OS terminates SCStream → browser process
detects device loss → fires `ended` event on track (browser-initiated, not
JS-initiated) → our bridge catches it.

**Why Meet's button fails:** Meet calls `track.stop()` from JS → `readyState`
becomes `'ended'` but `ended` event does NOT fire (per W3C spec) → our
bridge never gets notified.

### Other apps (Zoom, Teams)

Same pattern — all call `track.stop()` from JS when the user clicks their
in-app stop button. The `ended` event not firing is a spec feature, not a bug.

---

## 7. All Observable Signals (Complete Catalog)

### On the Track

| Signal | Type | Fires on `track.stop()`? | Fires on OS kill? | Pollable? |
|--------|------|-------------------------|-------------------|-----------|
| `ended` event | Event | **NO** | YES | — |
| `readyState` | Property | YES (`'ended'`) | YES (`'ended'`) | YES |
| `mute` event | Event | NO | NO | — |
| `muted` property | Property | NO | Varies | YES |
| `enabled` property | Property | Unchanged | Unchanged | YES |

### On the Stream

| Signal | Type | Fires on `track.stop()`? | Fires on OS kill? | App `removeTrack()`? |
|--------|------|-------------------------|-------------------|-----------------------|
| `inactive` event | Event | **YES** (when last track) | YES | NO |
| `removetrack` event | Event | NO | NO | **NO** (app-initiated) |
| `active` property | Property | YES (becomes `false`) | YES | YES (if empty) |
| `getTracks().length` | Method | Unchanged (track stays in stream) | Unchanged | Decreases |

### External APIs

| Signal | Useful? | Notes |
|--------|---------|-------|
| `navigator.permissions.query({name:'display-capture'})` | NO | Always returns `'prompt'` — spec mandates never `'granted'` |
| `navigator.mediaDevices.ondevicechange` | NO | Spec explicitly excludes display-capture sources |
| `CaptureController` | Limited | Zoom/wheel control only — no stop/lifecycle events |
| `track.getCaptureHandle()` | NO | Metadata about captured surface, no lifecycle |
| `document.onvisibilitychange` | NO | Unrelated to capture lifecycle |
| `chrome://webrtc-internals` | Debug only | Shows track state, not programmatically accessible |

### Summary: Which Signals Detect Each Stop Scenario

```
┌────────────────────────┬──────────┬──────────┬───────────┬───────────┐
│ Scenario               │ track    │ stream   │ track     │ stream    │
│                        │ 'ended'  │'inactive'│readyState │ .active   │
│                        │ event    │ event    │ poll      │ poll      │
├────────────────────────┼──────────┼──────────┼───────────┼───────────┤
│ macOS native stop      │   YES    │   YES    │   YES     │   YES     │
│ Windows native stop    │   YES    │   YES    │   YES     │   YES     │
│ Chrome bar stop        │   YES    │   YES    │   YES     │   YES     │
│ App: track.stop()      │   NO !!  │   YES    │   YES     │   YES     │
│ App: replaceTrack(null)│   NO     │   NO     │   NO      │   NO      │
│ App: removeTrack()     │   NO     │   NO     │   NO      │   YES*    │
│ App: discard reference │   NO     │   NO     │ (gc only) │ (gc only) │
│ Shared window closed   │   YES    │   YES    │   YES     │   YES     │
│ Window minimized       │   NO     │   NO     │   NO      │   NO      │
│                        │          │          │           │ (mute)    │
└────────────────────────┴──────────┴──────────┴───────────┴───────────┘

 * stream.active becomes false only when ALL tracks removed
```

---

## 8. Problems and Solutions

### Problem 1: Stop Detection (the original bug)

**Root cause:** W3C Media Capture spec §4.3.4 — `track.stop()` called from
JavaScript does NOT fire the `ended` event. Only external termination fires it.

**Old bridge** relied solely on `track 'ended'`:
```js
track.addEventListener('ended', function () {
  if (--pending === 0) _dispatchScreenShare(false);
});
```

**What worked:**
- macOS native stop → OS kills source → browser fires `ended` ✓
- Chrome bar stop → browser kills device → browser fires `ended` ✓
- Shared window closed → OS kills source → browser fires `ended` ✓

**What broke:**
- Google Meet "Stop presenting" → Meet calls `track.stop()` → NO event ✗

**Solution: State-check detection (events as hints, `stream.active` as authority)**

Events (`track 'ended'`, `stream 'inactive'`) are "check now" triggers — they
tell us *something changed*. But we never trust the event itself. Instead:

```js
function _checkEnded() {
  if (done || stream.active) return;   // stream.active is the ONLY authority
  done = true;
  _dispatchScreenShare(false, sid);
}

// Three detection layers, all calling the same _checkEnded:
tracks.forEach(function (track) {
  track.addEventListener('ended', _checkEnded);     // OS kill, browser kill
});
stream.addEventListener('inactive', _checkEnded);   // track.stop() from JS
setInterval(function () {                            // safety net
  _checkEnded();
  if (done) clearInterval(_poll);
}, 2000);
```

**Why this works for all scenarios:**
- `track.stop()` from JS → `inactive` event fires → `_checkEnded` reads
  `stream.active === false` → dispatches end
- OS kill → `ended` event fires → `_checkEnded` reads `stream.active === false`
  → dispatches end
- Neither event fires (unknown browser bug) → 2s poll reads
  `stream.active === false` → dispatches end
- Both events fire (OS kill, redundant) → first sets `done = true`, second
  short-circuits on `if (done)` → single dispatch, no double-fire

**Why `stream.active` is trustworthy:** It's a live getter on the browser's
internal stream state, not a cached JavaScript value. When the capture device
is released (any cause), the browser updates its internal state and
`stream.active` returns `false` immediately. No event needed.

---

### Problem 2: Prototype Bypass

**Old bridge** patched the instance:
```js
navigator.mediaDevices.getDisplayMedia = async function ...
```

**Bypass:** Any code calling `MediaDevices.prototype.getDisplayMedia.call(nav)`
goes through the original unpatched prototype method.

**Solution: Patch the prototype instead.**

```js
var _origProto = MediaDevices.prototype.getDisplayMedia;
MediaDevices.prototype.getDisplayMedia = async function (constraints) {
  var stream = await _origProto.call(this, constraints);
  // ... hook stream ...
  return stream;
};
```

All callers — instance, prototype, `.call()`, `.apply()` — go through our
patch. There's no way to bypass it without reaching into the browser's native
function (which JS cannot do after our patch runs at `document_start`).

---

### Problem 3: Iframe Isolation

**JavaScript Realms:** Each iframe has its own global scope with separate
prototypes. Patching the parent's `MediaDevices.prototype` does NOT propagate
to iframes.

**Solution: Three-layer coverage.**

1. **`all_frames: true` + `match_origin_as_fallback: true`** in manifest —
   Chrome injects our MAIN-world bridge into every frame (including
   `about:blank`, `blob:`, `srcdoc:` iframes on Chrome 119+).

2. **MutationObserver iframe propagation** — closes timing gap where
   same-origin `about:blank` iframe's `contentWindow` is available
   synchronously before Chrome's `all_frames` injection arrives:
   ```js
   new MutationObserver(function (mutations) {
     // for each added <iframe>, patch iframe.contentWindow.MediaDevices.prototype
   }).observe(document.documentElement, { childList: true, subtree: true });
   ```

3. **`__blsi_patched` flag** — prevents double-patch when both MO and Chrome
   injection fire for the same frame.

**Acceptable gap:** Cross-origin iframes block `contentWindow` access. Chrome's
`all_frames` handles those. Cross-origin `blob:` iframes on older Chrome
(<119, no `match_origin_as_fallback`) are unpatched — extremely rare for
`getDisplayMedia`.

---

### Problem 4: Per-Stream Identity Collision

**Old model:** Single `_sharePort` variable per tab. Two `getDisplayMedia`
calls from the same tab overwrite each other. Ending one kills both.

```
// Old — broken for concurrent shares:
_sharePort = chrome.runtime.connect({ name: 'blsi-screen-share' });
```

**Solution: Per-stream port tracking using `stream.id`.**

`MediaStream.id` is a browser-assigned 36-character UUID, available at stream
creation and stable for the stream's lifetime. No custom IDs needed — both
identifiers in our system come from the browser:

```
┌────────────┬──────────────────┬──────────────────┬───────────────────────┐
│ Layer      │ Identifier       │ Source           │ Purpose               │
├────────────┼──────────────────┼──────────────────┼───────────────────────┤
│ MAIN world │ stream.id        │ Browser assigns  │ Tag start/end msgs    │
│            │                  │ (MediaStream)    │ (survives in closure) │
├────────────┼──────────────────┼──────────────────┼───────────────────────┤
│ Isolated   │ stream.id        │ From postMessage │ Key in _sharePorts    │
│ world      │                  │                  │ map + port name       │
├────────────┼──────────────────┼──────────────────┼───────────────────────┤
│ Background │ port.name        │ Contains         │ Key in _sharePorts    │
│            │ ('blsi-ss-'+sid) │ stream.id        │ Map                   │
│            ├──────────────────┼──────────────────┼───────────────────────┤
│            │ port.sender      │ Chrome provides  │ Derive tabId for      │
│            │   .tab.id        │                  │ session storage key   │
├────────────┼──────────────────┼──────────────────┼───────────────────────┤
│ Session    │ tabId (string)   │ From port.sender │ Group streams by tab  │
│ storage    │ streamKey        │ port.name        │ Per-stream entry key  │
└────────────┴──────────────────┴──────────────────┴───────────────────────┘
```

---

## 9. New Architecture

### Session Storage Shape

```js
// chrome.storage.session['blsi_screen_share']:
{
  '42': {                                        // tabId (string)
    streams: {                                   // per-stream entries
      'blsi-ss-a7f3c2d1': { started_at: 1714700000000 },
      'blsi-ss-b8e2f4c9': { started_at: 1714700005000 },
    },
    suppressed_sites: []                         // per-tab (not per-stream)
  }
}
```

**Migration:** Old flat entries (`{ started_at, suppressed_sites }` without
`.streams`) are auto-migrated to
`{ streams: { '_migrated': { started_at } }, suppressed_sites }` by the
normalizer in `state.js`. The `'_migrated'` key has no matching port — next
disconnect or reconcile clears it.

### Data Flow

```
getDisplayMedia() resolves
        │
        ▼  MAIN world (main_world_bridge.js)
  stream.id = browser UUID
  _hookStream(stream) registers:
    track 'ended' → _checkEnded
    stream 'inactive' → _checkEnded
    2s setInterval poll → _checkEnded
  postMessage({ active: true, streamId: stream.id })
        │
        ▼  Isolated world (screen_share.js)
  _sharePorts[sid] = chrome.runtime.connect({ name: 'blsi-ss-' + sid })
  sendMessage({ type: SCREEN_SHARE_STARTED, streamId: sid })
        │
        ▼  Background (screen_share_bg.js)
  _sharePorts.set(port.name, { tabId, port })
  State.set_screen_share_active(tabId, port.name)
    → session: { '42': { streams: { 'blsi-ss-a7f3c2d1': {...} } } }
  broadcast SCREEN_SHARE_NOTIFY to all other tabs
        │
        │  ... share is active ... port keeps SW alive ...
        │
        ▼  Stream ends (any cause)
  _checkEnded() → stream.active === false → done = true
  postMessage({ active: false, streamId: stream.id })
        │
        ▼  Isolated world
  _sharePorts[sid].disconnect()
  delete _sharePorts[sid]
  sendMessage({ type: SCREEN_SHARE_ENDED, streamId: sid })
        │
        ▼  Background
  port.onDisconnect fires (crash-safety: fires even if ENDED never arrives)
    _sharePorts.delete(port.name)
    _tabHasActivePorts(tabId)?
      yes → State.remove_stream(tabId, port.name)
      no  → State.set_screen_share_inactive(tabId)
  broadcast SCREEN_SHARE_NOTIFY
```

### Edge Cases — Investigated

**Same tab, two getDisplayMedia calls:**
Stream #1 (id='aaa') and stream #2 (id='bbb') get independent ports
(`blsi-ss-aaa`, `blsi-ss-bbb`). Ending stream #1 → background checks
`_tabHasActivePorts(42)` → port B still exists → `remove_stream(42, 'blsi-ss-aaa')`.
Tab stays marked as sharing. When stream #2 ends → last port →
`set_screen_share_inactive(42)`. Correct.

**Tab closes mid-share:**
Chrome auto-disconnects all ports from that tab. Both `onDisconnect` handlers
fire (ordering is arbitrary but safe — see race analysis below). Session
cleaned, other tabs unblur.

**Port disconnect race (two ports, same tab, both disconnect):**
- `remove_stream` + `remove_stream` → both streams deleted → tab entry empty → auto-deleted ✓
- `remove_stream` + `set_inactive` → first removes one stream, second removes entire tab ✓
- `set_inactive` + `set_inactive` → first removes tab, second no-ops (key not in cache) ✓

**Service worker restart mid-share (E4) — not a real problem:**
Open `chrome.runtime.connect()` ports keep the SW alive indefinitely. Chrome
does NOT kill the SW or disconnect idle ports while any port is open. Our
port-per-stream design inherently keeps the SW alive for the duration of every
active share. Only extension updates kill ports — and `_reconcile_stale_shares()`
on init handles that by checking if tabs still exist.

**`stream.id` unavailable (E5) — not a real problem:**
W3C spec mandates `MediaStream.id` as a DOMString initialized to a UUID at
construction. No browser has ever shipped a broken `stream.id` after a
successful `getDisplayMedia()`. The `_fb_` fallback is dead code in practice.

**Stale poll timer (E8) — not a real problem:**
The closure holds `stream` alive, but `stream.active` is a live browser getter.
When the capture device is released (any cause), `active` returns `false`, the
next 2s poll tick detects it, `done = true`, `clearInterval` fires. Worst case:
2 extra seconds of memory before cleanup. No leak path.

---

## 10. Known Browser Bugs (Reference)

| Bug | Browser | Impact |
|-----|---------|--------|
| `mute`/`unmute` fires on cursor idle | Chrome ([#40137404](https://issues.chromium.org/issues/40137404)) | Breaks MediaRecorder timeupdate |
| `ended` not fired when shared window closed | Firefox ([#1615282](https://bugzilla.mozilla.org/show_bug.cgi?id=1615282)) | Stale capture state |
| Stop button should stop all display sharing | Firefox ([#1655078](https://bugzilla.mozilla.org/show_bug.cgi?id=1655078)) | Multiple active shares |
| `onended` not firing from Chrome stop button | Twilio SDK ([#849](https://github.com/twilio/twilio-video.js/issues/849)) | Stale SDK state |
| Inactive tab → track ends unexpectedly | Chrome | Premature capture loss |

---

## 11. Debug: Inspect Live Screen Share State

### In any tab's DevTools console (extension context)

```js
// Snapshot current screen share session storage (per-stream shape)
chrome.storage.session.get('blsi_screen_share', r =>
  console.log('screen_share:', JSON.stringify(r, null, 2))
);
// Expected shape when tab 42 is sharing with 2 streams:
// { "blsi_screen_share": {
//     "42": {
//       "streams": {
//         "blsi-ss-a7f3c2d1": { "started_at": 1714700000000 },
//         "blsi-ss-b8e2f4c9": { "started_at": 1714700005000 }
//       },
//       "suppressed_sites": []
//     }
// }}

// Live monitor changes
chrome.storage.session.onChanged.addListener(c => {
  if (c.blsi_screen_share)
    console.log('screen_share changed:', JSON.stringify(c.blsi_screen_share.newValue, null, 2));
});
```

### In the Google Meet tab's DevTools console (page context)

```js
// Patch getDisplayMedia to log track lifecycle and stream.id
const _orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getDisplayMedia = async function (c) {
  const stream = await _orig(c);
  console.log('[DBG] getDisplayMedia resolved, stream.id:', stream.id,
    'tracks:', stream.getTracks().length);

  stream.getTracks().forEach((t, i) => {
    console.log(`[DBG] track[${i}]: kind=${t.kind} readyState=${t.readyState}`);
    t.addEventListener('ended', () => console.log(`[DBG] track[${i}] 'ended' EVENT fired`));
    Object.defineProperty(t, '_origStop', { value: t.stop.bind(t) });
    t.stop = function () {
      console.log(`[DBG] track[${i}].stop() CALLED from JS`);
      console.trace();
      return t._origStop();
    };
  });

  stream.addEventListener('inactive', () =>
    console.log('[DBG] stream INACTIVE — stream.active:', stream.active));
  stream.addEventListener('removetrack', e =>
    console.log('[DBG] stream removetrack:', e.track.kind));

  // Poll readyState + stream.active
  const poll = setInterval(() => {
    const states = stream.getTracks().map(t => t.readyState);
    console.log('[DBG] poll — stream.id:', stream.id,
      'active:', stream.active, 'tracks:', states);
    if (!stream.active) clearInterval(poll);
  }, 1000);

  return stream;
};
console.log('[DBG] getDisplayMedia patched — start a screen share to see events');
```

This debug script will reveal exactly what Meet does when you click
"Stop presenting" — whether it calls `track.stop()`, and which events fire.

---

## 12. Verification Checklist

| # | Scenario | Expected | How to test |
|---|----------|----------|-------------|
| 1 | Google Meet "Stop presenting" | Blur clears, session `{}` | Share → click Meet stop → check storage |
| 2 | macOS native stop | Blur clears | Share → OS stop → check storage |
| 3 | Chrome bar stop | Blur clears | Share → Chrome "Stop sharing" → check storage |
| 4 | Two shares same tab | Stopping one keeps the other | Two getDisplayMedia → stop one → check storage has 1 stream |
| 5 | Tab close mid-share | Session cleaned, other tabs unblur | Share → close tab → check storage |
| 6 | iframe share | Detected and tracked | Page with iframe calling getDisplayMedia → check storage |
| 7 | Upgrade migration | Old shape auto-migrates | Install old version → share → upgrade → check storage shape |
| 8 | Shared window closed | Blur clears | Share window → close that window → check storage |
