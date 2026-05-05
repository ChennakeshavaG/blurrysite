# automate/screen_share_bg.tests Contract

## Overview

Unit-test suite for `src/automate/screen_share_bg.js`. Verifies the background-only
screen-share handler (`blsi.Automate.ScreenShareBg`) — session cleanup on init,
per-stream port lifecycle management, message handling (STARTED/ENDED/WHO_AM_I with
`streamId`), broadcast behavior, per-tab and per-stream isolation, and listener teardown.

The suite reloads `state.js` and then `screen_share_bg.js` per test
(`jest.resetModules()` + require). It captures `chrome.runtime.onConnect` and
`chrome.runtime.onMessage` listeners via `addListener.mockImplementation`.
Port objects are created via a `makePort(tabId, name)` helper that tracks
`onDisconnect` listeners and exposes a `_fireDisconnect()` trigger.
Default port name is `'blsi-ss-default'` (matches the `blsi-ss-` prefix filter).

## Describe groups

### `init`
- No-op when no active shares exist (no session writes).
- Removes stale share entries for dead tabs (tab no longer in `chrome.tabs.query`).
- Preserves active share for live tabs (tab still exists).
- Registers `onConnect` and `onMessage` listeners.

### `port handler`
- Port with name starting with `'blsi-ss-'` → `State.set_screen_share_active(tabId, portName)`.
- Port disconnect → checks `_tabHasActivePorts(tabId)`: if last port, `State.set_screen_share_inactive(tabId)`; if more ports remain, `State.remove_stream(tabId, portName)` + broadcast `SCREEN_SHARE_NOTIFY` to all tabs.
- Port with wrong name prefix → ignored (no State call).
- Port with no `sender.tab.id` → ignored.

### `message handler`
- `SCREEN_SHARE_STARTED` (with `streamId`) → sets active + broadcasts (excluding sender) + responds `{ ok: true }`. Returns `true` (async).
- `SCREEN_SHARE_ENDED` (with `streamId`) → clears state (stream or tab) + broadcasts (all tabs) + responds `{ ok: true }`. Returns `true` (async).
- `WHO_AM_I` → responds `{ tab_id: number }` synchronously. Returns `false`.
- `WHO_AM_I` with no sender tab → responds `{ tab_id: null }`.
- Unhandled message type → returns `undefined`, no `sendResponse` call.
- `null` message → returns `undefined`.

### `per-tab isolation`
- Two tabs sharing simultaneously — both entries exist in `_sharing_tab_ids`.
- Port disconnect clears only that tab — other tab persists.
- ENDED message clears only sender tab's entry.
- `get_screen_share_state(tabId)` reports queried tab info when sharing.

### `per-stream isolation (same tab)`
- Two streams from same tab — both tracked (single tab id in `_sharing_tab_ids`).
- Disconnecting one stream keeps tab active when another remains (`_tabHasActivePorts` returns true → `State.remove_stream`).
- Disconnecting last stream clears tab entirely (`State.set_screen_share_inactive`).

### `destroy`
- Removes `onConnect` and `onMessage` listeners.
- Is idempotent — no error when called without prior init.

### `broadcast`
- STARTED broadcast excludes the sender tab id.
- ENDED broadcast includes all tabs.

### `module export`
- Exposed as `blsi.Automate.ScreenShareBg` with `init` and `destroy`.
- Object is frozen.

## Edge cases covered

- Null message — early return, no crash.
- Port with no sender tab id — ignored.
- Wrong port name prefix — ignored.
- WHO_AM_I with missing sender.tab — returns `{ tab_id: null }`.
- Unhandled message types — returns `undefined` (doesn't interfere with other listeners).
- Two streams from same tab — per-stream port disconnect logic correct.
- Last stream disconnect → full tab clear; non-last → stream removal only.

## Known gaps

- No test for Logger calls (internal logging, not contractual).
- No integration test with real `chrome.runtime.connect` port lifecycle.
