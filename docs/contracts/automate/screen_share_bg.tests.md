# automate/screen_share_bg.tests Contract

## Overview

Unit-test suite for `src/automate/screen_share_bg.js`. Verifies the background-only
screen-share handler (`blsi.Automate.ScreenShareBg`) — session cleanup on init,
port lifecycle management, message handling (STARTED/ENDED/WHO_AM_I), broadcast
behavior, and listener teardown.

The suite reloads `state.js` and then `screen_share_bg.js` per test
(`jest.resetModules()` + require). It captures `chrome.runtime.onConnect` and
`chrome.runtime.onMessage` listeners via `addListener.mockImplementation`.
Port objects are created via a `makePort(tabId, name)` helper that tracks
`onDisconnect` listeners and exposes a `_fireDisconnect()` trigger.

## Describe groups

### `init`
- No-op when no active shares exist (no session writes).
- Removes stale share entries for dead tabs (tab no longer in `chrome.tabs.query`).
- Preserves active share for live tabs (tab still exists).
- Registers `onConnect` and `onMessage` listeners.

### `port handler`
- Port with name `'blsi-screen-share'` → `State.set_screen_share_active(tabId)`.
- Port disconnect → `State.set_screen_share_inactive(tabId)` (per-tab) + broadcast `SCREEN_SHARE_NOTIFY` to all tabs.
- Port with wrong name → ignored (no State call).
- Port with no `sender.tab.id` → ignored.

### `message handler`
- `SCREEN_SHARE_STARTED` → sets active + broadcasts (excluding sender) + responds `{ ok: true }`. Returns `true` (async).
- `SCREEN_SHARE_ENDED` → `State.set_screen_share_inactive(sender.tab.id)` (per-tab) + broadcasts (all tabs) + responds `{ ok: true }`. Returns `true` (async).
- `WHO_AM_I` → responds `{ tab_id: number }` synchronously. Returns `false`.
- `WHO_AM_I` with no sender tab → responds `{ tab_id: null }`.
- Unhandled message type → returns `undefined`, no `sendResponse` call.
- `null` message → returns `undefined`.

### `per-tab isolation`
- Two tabs sharing simultaneously — both entries exist in `_sharing_tab_ids`.
- Port disconnect clears only that tab — other tab persists.
- ENDED message clears only sender tab's entry.
- `get_screen_share_state(tabId)` reports queried tab info when sharing.

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
- Wrong port name — ignored.
- WHO_AM_I with missing sender.tab — returns `{ tab_id: null }`.
- Unhandled message types — returns `undefined` (doesn't interfere with other listeners).

## Known gaps

- No test for Logger calls (internal logging, not contractual).
- No integration test with real `chrome.runtime.connect` port lifecycle.
