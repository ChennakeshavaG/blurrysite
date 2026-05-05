# automate/screen_share.tests Contract

## Overview

Unit-test suite for `src/automate/screen_share.js`. Verifies the isolated-world
screen-share postMessage bridge (`blsi.Automate.ScreenShare`) — listener registration
on `window` for `'message'` events (filtered by `data.type === '__blsi_screen_share'`
+ `data.streamId`), per-stream port lifecycle, WHO_AM_I tab-id caching, and message
sending (with `streamId`) to background.

The suite reloads `state.js` and then `screen_share.js` per test
(`jest.resetModules()` + require). It spies on `window.addEventListener` /
`removeEventListener` to capture and fire the message handler with
`{ data: { type: '__blsi_screen_share', active, streamId } }`.
`chrome.runtime.connect` is mocked to return per-port objects tracked in a
`mockPorts` map keyed by port name (e.g. `'blsi-ss-abc-123'`).

## Describe groups

### `init`
- Registers `message` listener on `window`.
- Fires `whoAmI()` on init (sends WHO_AM_I message).
- Is idempotent — second `init()` is a no-op (single `addEventListener` call, no remove).

### `message filtering`
- Ignores messages with wrong `data.type`.
- Ignores messages with no `data`.
- Ignores messages with no `streamId` (guard at top of handler).

### `share start`
- Opens port with name `'blsi-ss-<streamId>'` via `chrome.runtime.connect`.
- Sends `SCREEN_SHARE_STARTED` message with `streamId` to background.

### `share end`
- Disconnects the port for that stream and sends `SCREEN_SHARE_ENDED` with `streamId`.
- Sends ENDED even if no port was open for that stream (end without prior start — no disconnect call, message still sent).

### `per-stream tracking`
- Two streams open independently — ending one does not disconnect the other.
- Ending second stream disconnects its port.

### `destroy`
- Disconnects ALL open ports and removes `window 'message'` listener.
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
- Share end with no prior start — port disconnect skipped, ENDED still sent with streamId.
- Messages without `streamId` — silently dropped (no connect, no sendMessage).
- Double init — no-op, listener count stays at 1.
- Double destroy — no-throw idempotency.
- Two concurrent streams — independent port lifecycle per streamId.
- Destroy with multiple open ports — all disconnected.

## Known gaps

- No test for port `onDisconnect` from the content side (that's background-side behavior tested in `screen_share_bg.test.js`).
- No integration test with real `postMessage` from MAIN world bridge.
