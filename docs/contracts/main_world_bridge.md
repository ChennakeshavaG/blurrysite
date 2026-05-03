# main_world_bridge Contract

## Overview

A bare IIFE (no `blsi.*` global) that runs in the page's MAIN world at `document_start` — before any page JavaScript. Patches two native browser APIs to signal the isolated-world content scripts. Screen-share signals use `window.postMessage` (crosses the MAIN↔ISOLATED world boundary reliably); shadow-root signals use `CustomEvent` on the host element (same DOM, no data payload needed). Has no `chrome.*` access and no `blsi.*` references.

## No Public API

This module exports nothing. It operates via side effects on `navigator.mediaDevices` and `Element.prototype`.

## Intercepted APIs

### `navigator.mediaDevices.getDisplayMedia` patch

**What**: Wraps `getDisplayMedia` to signal screen-share start/end via `window.postMessage({ type: '__blsi_screen_share', active })`.  
**Guard**: Only patches if `navigator.mediaDevices` exists and `getDisplayMedia` is a function.  
**On call**: Awaits the original `getDisplayMedia(constraints)`; posts `{ active: true }` on success.  
**On end**: Attaches `'ended'` listeners to all tracks; posts `{ active: false }` when the last track ends.  
**Edge case**: If the returned stream has 0 tracks, posts `active: false` immediately (avoids an orphaned `active: true` with no cleanup).  
**Listener in isolated world**: `automate/screen_share.js` listens for `window 'message'` events matching `data.type === '__blsi_screen_share'`.

### `Element.prototype.attachShadow` patch

**What**: Wraps `attachShadow` to fire `'__blsi_shadow_attached'` CustomEvent on the host element after shadow root creation.  
**Guard**: Only patches if `Element` and `attachShadow` exist.  
**Event**: `bubbles: true, composed: true` — propagates up through shadow boundaries.  
**Skip condition**: Does NOT fire for `{ mode: 'closed' }` shadow roots — the extension cannot observe closed roots anyway (`el.shadowRoot` returns `null` from outside).  
**Listener in isolated world**: `blur_engine.js` listens for this via `_initShadowAttachListener()` to discover shadow roots attached asynchronously after the initial idle-callback stamp pass.

## Internal Helpers

### `_dispatchScreenShare(active)`

**What**: Posts `{ type: '__blsi_screen_share', active }` via `window.postMessage('*')`. Uses postMessage instead of CustomEvent because `CustomEvent.detail` does not reliably cross the MAIN→ISOLATED world boundary in Chrome.  
**Params**: `active` (boolean)  
**Used by**: The patched `getDisplayMedia` on share start and on last-track-ended.

## Invariants

- No `chrome.*` API calls — this file runs in MAIN world where `chrome` is unavailable.
- No `blsi.*` references — `blsi` global is not yet defined when this runs (`document_start`).
- All patches are guarded by `typeof` / property-existence checks — safe on pages that don't support these APIs.
- `_origGetDisplayMedia` and `_origAttachShadow` capture the originals before patching, preserving full original behavior.
- Closed shadow roots are intentionally skipped — no event is emitted.
