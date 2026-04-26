# tab_privacy Contract

## Overview

Hides the browser tab title and favicon during screen sharing for privacy. Replaces the tab title with `"Tab"` and all favicon links with a 1×1 transparent PNG. Restores originals on `disable()`. Purely DOM-based — no storage, no chrome.* API calls.

## Module State

| Variable | Type | Description |
|---|---|---|
| `_originalTitle` | `string\|null` | Saved `document.title` before masking |
| `_originalFavicons` | `Array<{el, href}>\|null` | Saved favicon elements; `href: null` means the element was created by us (not existing) |
| `_active` | `boolean` | Whether tab privacy is currently active |
| `_nativeTitleDescriptor` | `PropertyDescriptor\|null` | Cached native `Document.prototype` `title` accessor; restored on `disable()` |
| `_pendingTitle` | `string\|null` | Latest title the page attempted to set while obscured (captured by the property setter override) |

## Public API

### enable()

**What**: Saves and replaces the tab title + all favicon `<link>` elements with blank values, and installs a `document.title` accessor override that prevents the host page from leaking real titles while obscured.
**Params**: none  
**Returns**: `void`  
**Side effects**:
- Caches `Object.getOwnPropertyDescriptor(Document.prototype, 'title')` into `_nativeTitleDescriptor`
- Defines a custom accessor on `document` so `document.title` always reads as `'Tab'` and any page-side write is captured into `_pendingTitle` instead of reaching the `<title>` element
- Writes `'Tab'` to the underlying `<title>` element via the cached native setter
- Replaces `href` on every `link[rel*="icon"]` with a 1×1 transparent PNG data URI
- If no favicon links exist, creates and appends a new one with `href: null` recorded so `disable()` removes it
- Sets `_active = true`  
**Handles**: Idempotent — no-op if already active (`_active === true`).

### disable()

**What**: Restores the native `document.title` accessor and the original favicon `<link>` elements; writes back the most recent title the page attempted to set while obscured (or the pre-enable title if the page never wrote).
**Params**: none  
**Returns**: `void`  
**Side effects**:
- Re-installs `_nativeTitleDescriptor` on `document` via `Object.defineProperty`, restoring the native getter/setter
- Sets `document.title` to `_pendingTitle ?? _originalTitle` so SPAs that updated their title during obscured mode see their latest value, not a stale pre-enable value
- For each saved favicon: if `href` was `null` (we created it) → removes the element; otherwise restores `el.href`
- Clears `_originalTitle`, `_originalFavicons`, `_nativeTitleDescriptor`, `_pendingTitle`; sets `_active = false`  
**Handles**: Idempotent — no-op if not active (`_active === false`).

### isActive()

**What**: Returns whether tab privacy is currently enabled.  
**Params**: none  
**Returns**: `boolean` — `true` if currently masking title/favicon  
**Side effects**: none  
**Note**: This is a plain function, not a getter (despite CLAUDE.md table notation).

## Invariants

- `enable()` followed by `disable()` always restores DOM to original (or latest page-attempted) state.
- Only one active session at a time — `enable()` is idempotent.
- Created favicons (`href: null`) are always removed; never left in DOM after `disable()`.
- While `_active === true`, reads of `document.title` always return `'Tab'`; writes are captured into `_pendingTitle` and never reach the underlying `<title>` element.
