# automate/visibility Contract

## Overview

Per-tab observer for the page's lifecycle state (visible vs hidden, focused vs unfocused). Translates DOM events (`visibilitychange`, `window.blur`, `window.focus`) into a `'armed' | 'fired'` phase. **Only `'fired'` is persisted** to `KEYS.tab_switch_by_tab[tab_id]`; `'armed'` writes pass `'off'` to State, which strips the entry (absence === armed/off — keeps the map small since most tabs are armed most of the time). The map only carries tabs that are currently in the `fired` state.

Replaces the tab-switch portion of the deleted `src/auto_blur.js`. The published phase is binary — `armed` (tab is visible AND window has focus) or `fired` (anything else).

Loaded in CONTENT context only. One instance per tab — `init({tab_id})` is called once from `content_script.init()` after `WHO_AM_I` resolves.

Exposed as `blsi.Automate.Visibility` (IIFE — no ES module syntax).

## Public API

### `init({tab_id})` → void

Idempotent. Registers `visibilitychange` (on `document`), `focus` (on `window`), and `blur` (on `window`) listeners. Computes the current presence state and writes the corresponding phase via `blsi.Automate.State.write_tab_switch(tab_id, phase)`.

Params:
- `tab_id: number` — required. Used as the storage map key. Provided by `blsi.ScreenShare.getTabId()` after the WHO_AM_I round-trip in content_script init.

Side effects:
- Three event listeners registered with `{capture: true}` so they run before page handlers.
- On init, evaluates the lifecycle state and writes only if the derived phase is `fired` (otherwise no storage write — absence === armed).

Edge cases:
- Called without a numeric `tab_id` → no-op (does not register listeners).
- Called twice with the same `tab_id` → second call is a no-op (caches `_initialized`).
- Called twice with different `tab_id`s → second call destroys then re-inits (rare; happens when WHO_AM_I returns a different value, e.g., across SW restarts in tests).

### `destroy()` → void

Removes the three event listeners. Writes `'off'` to clear the tab's entry from `KEYS.tab_switch_by_tab` (so a torn-down tab doesn't leave stale `fired` state).

## Internal mechanics

### Context invalidation (`_context_alive` / `_teardown_stale`)

`_context_alive()` checks `chrome.runtime.id` — returns `false` when the extension context is invalidated (extension reloaded without tab reload).

`_teardown_stale()` removes all three DOM event listeners and resets state (`_tab_id = null`, `_initialized = false`) but does NOT call `State.clear_tab_switch` — the chrome.storage API is dead, so writing would throw. This is the centralized teardown point: once visibility stops firing, the downstream crash chain (State `_fire_subscribers` → Manager `_evaluate` → `chrome.i18n` / `chrome.storage.session`) is eliminated.

`destroy()` is for live teardown (calls `State.clear_tab_switch` to clean up storage). `_teardown_stale()` is for dead-context teardown (skips storage, just removes listeners).

### Phase derivation

`_evaluate_and_write` reads two live signals on every call:
```
document.visibilityState !== 'hidden'   AND
document.hasFocus() === true             →  active   (write 'off' → strips entry → armed)
otherwise                                →  inactive (write 'fired')
```

Both checks are needed: a tab can be `visible` (rendered on screen, e.g. side-by-side window layout) while another window has actual focus — `visibilityState` alone misses that case.

There is no `frozen` handling at the source level; the browser fires `visibilitychange` to `hidden` when freezing, which already produces `fired`. If we later need to distinguish, we can read `document.wasDiscarded` or listen to `freeze` / `resume` events.

### Listeners

| Event | Source | Phase consequence |
|---|---|---|
| `visibilitychange` (visible) | `document` | re-derive; usually `armed` |
| `visibilitychange` (hidden) | `document` | `fired` |
| `focus` | `window` | re-derive; usually `armed` |
| `blur` | `window` | re-derive; usually `fired` |

Every event runs the same `_evaluate_and_write()` handler — same function reference is used for `addEventListener` / `removeEventListener`, so no alias variables are needed. The handler calls `State.write_tab_switch`, which is idempotent — same-value writes short-circuit at the State layer.

We listen to `window.focus` / `window.blur` rather than `focusin` / `focusout`. The latter bubble through every element-level focus change inside the page (input clicks, tab-through), which is far noisier than the window-level signal we want.

### No debounce

Phase derivation is event-instant. We do not hand-roll the 150ms / 250ms debounces that the old `auto_blur.js` carried — those were filtering legitimate transitions State idempotency handles natively (drag-to-new-window appears as `hidden` → `visible` within 10ms; `State.write_tab_switch` produces two writes that cancel out at the cache level when the second is a same-value no-op).

If the write storm from rapid transitions becomes a problem, we add a microtask-level coalescer here. Not in v1.

### Tab close

Content script does not see `chrome.tabs.onRemoved`. Background owns the cleanup — listens to `chrome.tabs.onRemoved` and calls `blsi.Automate.State.clear_tab_switch(tab_id)` to strip the entry. (See `automate/idle.md` for analogous suppressed-tab cleanup pattern in screen-share.)

## Invariants

- Exactly one set of listeners registered per content-script instance after `init()`.
- `_evaluateAndWrite` runs only after `init({tab_id})` has cached the tab id.
- Writes go through `blsi.Automate.State.write_tab_switch` — never directly to `chrome.storage.session.set`.
- `destroy()` always writes `'off'` to clear, even if the listener is in the middle of an event.
- The exported `Visibility` object is frozen.

## Edge cases / gotchas

- **Iframes**: `init()` is called from `content_script.init()` only when `IS_MAIN_FRAME` is true. Iframes do not observe presence independently — they would fragment the per-tab state.
- **Extension context invalidated**: `_evaluate_and_write` checks `chrome.runtime.id` at the top. When the extension is reloaded but the tab is not, `chrome.runtime.id` becomes `undefined` — the handler calls `destroy()` to remove all three event listeners and stop further writes into the dead context. This is the centralized teardown point for the stale-content-script problem: once visibility stops calling `State.write_tab_switch`, the downstream crash chain (State → Manager → `chrome.i18n` / `chrome.storage.session`) is eliminated.
- **Popup-open false positive**: opening the extension popup steals focus → `window.blur` fires → state becomes `fired` → page blurs. Same problem the old debounce mitigated. Future improvement (out of scope for v1): background broadcasts a `popup-opened` flag that suppresses the next `passive` transition for ~500ms.
- **DevTools docked**: docking devtools triggers `window.blur` on the page. State becomes `fired`. Acceptable.
- **iOS Safari `visibilitychange` quirks**: not relevant — extension doesn't run on iOS Safari.
- **Frozen state**: Chrome may freeze background tabs after long periods (`document.wasDiscarded`). The freeze event is not currently observed; the prior `hidden` write already represents the intent.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `content_script.init()` (after WHO_AM_I) | `Visibility.init({tab_id})` | Once at startup, main frame only |
| `content_script.applyState` | (no direct call) | State is read via `Store.resolve()` → `State.read_tab_switch(tab_id)` |
| `background.js` (`chrome.tabs.onRemoved`) | (no direct call) | Calls `State.clear_tab_switch(tab_id)` to strip closed-tab entries |

## Test strategy

- jsdom provides `document.visibilityState`, `document.hidden`, `window.addEventListener`, `document.hasFocus()`. Mock `document.hasFocus` returns and `Object.defineProperty(document, 'visibilityState', ...)` to script transitions.
- Cover: initial state on init (visible+focused → `armed`); visibility change to hidden → `fired`; window blur → `fired`; window focus from blurred → `armed`; double-init with same tab id is no-op; double-init with different tab id re-binds; destroy clears entry; state writes go through `State.write_tab_switch`. Phase assertions read via `State.read_tab_switch(tab_id)` — visibility itself does not expose a current-phase accessor.
