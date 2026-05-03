# automate/screen_share.tests Contract

## Overview

Unit-test suite for `src/automate/screen_share.js`. Verifies the isolated-world
screen-share postMessage bridge (`blsi.Automate.ScreenShare`) — listener registration
on `window` for `'message'` events (filtered by `data.type === '__blsi_screen_share'`),
port lifecycle, WHO_AM_I tab-id caching, and message sending to background.

The suite reloads `state.js` and then `screen_share.js` per test
(`jest.resetModules()` + require). It spies on `window.addEventListener` /
`removeEventListener` to capture and fire the message handler with
`{ data: { type: '__blsi_screen_share', active } }`.
`chrome.runtime.connect` is mocked to return a fake port object.

## Describe groups

### `init`
- Registers `message` listener on `window`.
- Fires `whoAmI()` on init (sends WHO_AM_I message).
- Is idempotent — second `init()` is a no-op (single `addEventListener` call, no remove).

### `message filtering`
- Ignores messages with wrong `data.type`.
- Ignores messages with no `data`.

### `share start`
- Opens port with name `'blsi-screen-share'` via `chrome.runtime.connect`.
- Sends `SCREEN_SHARE_STARTED` message to background.

### `share end`
- Disconnects port and sends `SCREEN_SHARE_ENDED` message.
- Sends ENDED even if no port was open (end without prior start).

### `destroy`
- Disconnects open port and removes `window 'message'` listener.
- Is idempotent — no error when called twice.
- Does NOT clear `_myTabId` — tab id stays cached after destroy.

### `whoAmI`
- Caches tab id from WHO_AM_I response.
- Second call reuses cached promise — no extra `sendMessage`.
- Resolves `null` on SW failure (undefined response).
- Resolves `null` when `sendMessage` throws.

### `getTabId`
- Returns `null` before `whoAmI()` resolves.

### `module export`
- Exposed as `blsi.Automate.ScreenShare` with 4 methods.
- Object is frozen.

## Edge cases covered

- `sendMessage` throws (Extension context invalidated) — `whoAmI` resolves null.
- `chrome.runtime.lastError` set during callback — swallowed, resolves null.
- Share end with no prior start — port disconnect skipped, ENDED still sent.
- Double init — destroy called first, listener count stays at 1.
- Double destroy — no-throw idempotency.

## Known gaps

- No test for port `onDisconnect` from the content side (that's background-side behavior tested in `screen_share_bg.test.js`).
- No integration test with real `postMessage` from MAIN world bridge.
