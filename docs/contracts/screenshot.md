# screenshot Contract

## Overview

Captures the viewport as a PNG with all active blur/redaction visible in the output (CSS filters are captured by `captureVisibleTab`). Requires background relay for `captureVisibleTab` permission. Provides full-viewport capture, optional crop-region selection, download, and clipboard copy.

## Module State

| Variable | Description |
|---|---|
| `_cropOverlay` | `HTMLElement\|null` — the fixed-position crop overlay div |
| `_cropCallback` | `Function\|null` — callback from the `startCrop()` caller |

## Public API

### captureViewport()

**What**: Captures the full visible viewport as a PNG data URL via background relay.  
**Params**: none  
**Returns**: `Promise<string>` — PNG data URL  
**Side effects**: Sends `{ type: 'CAPTURE_VIEWPORT' }` to `background.js`; background calls `chrome.tabs.captureVisibleTab()`  
**Handles**: `chrome.runtime.lastError` → rejects with error message; missing `response.dataUrl` → rejects.

### download(dataUrl, filename?)

**What**: Triggers a browser download of the given data URL as a PNG file.  
**Params**: `dataUrl` (string) — PNG data URL; `filename` (string, optional) — download filename (default: `'blurrysite-screenshot-<timestamp>.png'`)  
**Returns**: `void`  
**Side effects**: Creates a hidden `<a>` element, appends to body, clicks it, removes it.

### copyToClipboard(dataUrl)

**What**: Copies the data URL image to the system clipboard.  
**Params**: `dataUrl` (string) — PNG data URL  
**Returns**: `Promise<void>`  
**Side effects**: `fetch(dataUrl)` → blob → `navigator.clipboard.write([ClipboardItem])` 
**Handles**: Requires `navigator.clipboard.write` + `ClipboardItem` API (modern browsers only); throws if clipboard permissions denied.

### startCrop(callback)

**What**: Enters crop mode — overlays the viewport with a crosshair div; user drags to select a region.  
**Params**: `callback` (function) — called with `{ x, y, width, height, dataUrl }` on success or `null` on cancel/error  
**Returns**: `void`  
**Side effects**:
- Calls `cancelCrop()` first to clean up any previous crop session
- Appends a full-viewport fixed overlay `<div>` to `document.body`
- On mouseup: captures viewport, crops to selection, calls callback  
**Handles**:
- Selection smaller than 10×10px → calls `callback(null)` (too small, treat as cancel)
- `captureViewport()` failure → calls `callback(null)`
- `_cropImage()` failure → calls `callback(null)`

### cancelCrop()

**What**: Exits crop mode and removes the overlay.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Removes `_cropOverlay` from DOM; clears `_cropOverlay` and `_cropCallback`  
**Handles**: Idempotent — no-op if not in crop mode.

## Internal Functions

### _cropImage(dataUrl, x, y, w, h)

**What**: Crops a data URL to the specified viewport-coordinate region.  
**Params**: `dataUrl` (string), `x` (number), `y` (number), `w` (number), `h` (number) — all in CSS pixels  
**Returns**: `Promise<string>` — cropped PNG data URL  
**Side effects**: Creates a canvas element; uses `window.devicePixelRatio` to scale for HiDPI displays  
**Handles**: `canvas.getContext('2d')` returning null → rejects with error; image load failure → rejects.

## Invariants

- CSS filters are captured in the screenshot output — `captureVisibleTab` captures the composited viewport including CSS effects.
- `startCrop()` always calls `cancelCrop()` first — only one crop session active at a time.
- `_cropImage` scales all coordinates by `window.devicePixelRatio` for HiDPI accuracy — never use raw CSS pixels with the canvas draw call.
- Crop regions smaller than 10×10px trigger `callback(null)` — protects against accidental single-click captures.
