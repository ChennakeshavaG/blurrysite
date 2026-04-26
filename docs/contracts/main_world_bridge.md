# main_world_bridge Contract

## Overview

A bare IIFE (no `blsi.*` global) that runs in the page's MAIN world at `document_start` — before any page JavaScript. Patches two native browser APIs to emit `CustomEvent`s that the isolated-world content scripts can listen for. Has no `chrome.*` access and no `blsi.*` references; all communication is via `CustomEvent` only.

## No Public API

This module exports nothing. It operates via side effects on `navigator.mediaDevices` and `Element.prototype`.

## Intercepted APIs

### `navigator.mediaDevices.getDisplayMedia` patch

**What**: Wraps `getDisplayMedia` to fire `'__blsi_screen_share'` CustomEvents on `document` when screen sharing starts and ends.  
**Guard**: Only patches if `navigator.mediaDevices` exists and `getDisplayMedia` is a function.  
**On call**: Awaits the original `getDisplayMedia(constraints)`; fires `{ detail: { active: true } }` on success.  
**On end**: Attaches `'ended'` listeners to all tracks; fires `{ detail: { active: false } }` when the last track ends.  
**Edge case**: If the returned stream has 0 tracks, fires `active: false` immediately (avoids an orphaned `active: true` event with no cleanup).  
**Listener in isolated world**: `screen_share.js` listens for this event on `document`.

### `Element.prototype.attachShadow` patch

**What**: Wraps `attachShadow` to fire `'__blsi_shadow_attached'` CustomEvent on the host element after shadow root creation.  
**Guard**: Only patches if `Element` and `attachShadow` exist.  
**Event**: `bubbles: true, composed: true` — propagates up through shadow boundaries.  
**Skip condition**: Does NOT fire for `{ mode: 'closed' }` shadow roots — the extension cannot observe closed roots anyway (`el.shadowRoot` returns `null` from outside).  
**Listener in isolated world**: `blur_engine.js` listens for this via `_initShadowAttachListener()` to discover shadow roots attached asynchronously after the initial idle-callback stamp pass.

## Internal Helpers

### `_dispatchScreenShare(active)`

**What**: Fires `'__blsi_screen_share'` CustomEvent on `document`.  
**Params**: `active` (boolean)  
**Used by**: The patched `getDisplayMedia` on share start and on last-track-ended.

## Invariants

- No `chrome.*` API calls — this file runs in MAIN world where `chrome` is unavailable.
- No `blsi.*` references — `blsi` global is not yet defined when this runs (`document_start`).
- All patches are guarded by `typeof` / property-existence checks — safe on pages that don't support these APIs.
- `_origGetDisplayMedia` and `_origAttachShadow` capture the originals before patching, preserving full original behavior.
- Closed shadow roots are intentionally skipped — no event is emitted.
