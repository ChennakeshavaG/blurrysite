# screenshot Test Contract

## Overview

Tests for `src/screenshot.js`, exposed as `blsi.Screenshot`. The module provides viewport capture (relayed through background via `CAPTURE_VIEWPORT` message), file download, clipboard copy, and a crop-selection overlay. Tests cover the happy path for `captureViewport`, two rejection paths, a no-throw check for `download`, overlay injection via `startCrop`, and safe teardown via `cancelCrop`. Each test reloads the module fresh (`jest.isolateModules`) to avoid state leaking between tests. The file's own annotation block documents known redundancies and missing coverage.

## Setup & Teardown

- `freshLoad()` — deletes `blsi.Screenshot`, calls `jest.resetModules()`, then uses `jest.isolateModules()` to `require(MODULE_PATH)`. Called in every `beforeEach`.
- `beforeEach`: calls `freshLoad()`; clears `document.body.innerHTML`.
- `afterEach`: calls `blsi.Screenshot.cancelCrop()` (cleanup); clears `document.body.innerHTML`.

## Test Groups

### screenshot.js

- `captureViewport sends CAPTURE_VIEWPORT message` — mocks `chrome.runtime.sendMessage` to expect `msg.type === 'CAPTURE_VIEWPORT'` and reply with `{ dataUrl: testDataUrl }`; asserts resolved value equals `testDataUrl`.
- `captureViewport rejects on runtime error` — mocks `sendMessage` to set `chrome.runtime.lastError` then call callback with `undefined`; asserts `captureViewport()` rejects with message `'Tab not found'`.
- `captureViewport rejects when no data returned` — mocks `sendMessage` to call callback with `{}`(no `dataUrl`); asserts `captureViewport()` rejects with message `'No screenshot data'`.
- `download does not throw` — calls `blsi.Screenshot.download('data:image/png;base64,abc', 'test.png')` and asserts no exception (jsdom cannot verify anchor click or navigation).
- `startCrop creates an overlay element on the body` — records `document.body.children.length` before, calls `startCrop(jest.fn())`, asserts child count increased.
- `cancelCrop removes the overlay` — calls `startCrop` then `cancelCrop`; asserts no throw (no DOM assertion present — documented gap).
- `cancelCrop is safe when no crop active` — calls `cancelCrop()` with no prior `startCrop`; asserts no throw.

## Edge Cases Covered

- `chrome.runtime.lastError` set synchronously inside the `sendMessage` mock callback, then cleared after — mirrors Chrome's actual lastError lifecycle.
- `cancelCrop` called defensively in `afterEach` regardless of test path, preventing overlay leaks between tests.
- Module isolation via `jest.isolateModules` + `delete blsi.Screenshot` ensures no cross-test state in the IIFE closure.

## Coverage Gaps

Documented in the test file's annotation block:

- `copyToClipboard()` — public API method with zero test coverage.
- Crop drag sequence — `mousedown` → `mousemove` → `mouseup` → callback with selection rect not tested.
- Undersized crop region (< 10×10 px) — expected to pass `null` or skip; not tested.
- `startCrop()` called while a crop is already active — expected to cancel and restart; not tested.
- `cancelCrop removes the overlay` test has no DOM assertion (no check that overlay child count returns to zero).
- `download()` anchor element creation and programmatic click cannot be verified in jsdom.
- The two rejection tests (`lastError` and `no data`) are structurally identical and are noted as `test.each` candidates.
