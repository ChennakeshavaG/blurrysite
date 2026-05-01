# Automate storage redesign — working plan

Working document. Captures the current state of the automate triggers, the problems we're solving, and the redesign decisions as we make them. Update in place as we go.

---

## Status snapshot

- [ ] **Idle** — analysis done; decisions pending.
- [ ] **Tab switch** — not yet started.
- [ ] **Screen share** — not yet started.

---

## Why we're redoing this

User-stated reason: "I don't like the current config." The dislikes have not been enumerated yet — we're capturing the current state first, then deciding per trigger.

Known structural pain points (from the deep dive in storage-layout.md and the side-by-side comparison):

1. Three triggers, three completely different detection mechanisms, three different write paths. Idle and tab_switch share state (`blsi_automate_blur[host]`); screen_share is in a separate global record (`blsi_screen_share`). No unified concept of "automate is active because of X".
2. Idle and tab_switch share an `_isIdle` flag inside `auto_blur.js`. Once one fires, the other is suppressed until `onActive` clears both. The session storage record (per host) loses the distinction.
3. `screen_share.js` listener registers ONLY when `automate.screen_share.enabled` resolves true for the current host. The `getDisplayMedia` patch in `main_world_bridge.js` always runs. If a site rule disables screen-share for the sharing host, the patch fires a CustomEvent that nobody hears → no broadcast → other tabs never blur.
4. Idle/tab_switch state is per-host (`blsi_automate_blur[host]`). Screen-share is global (one record). Suppression has three different scopes (`tab` / `site_session` / `feature`) split across two keys.
5. Owner asymmetry: idle/tab_switch writes happen in content_script; screen_share writes happen in background.js. No single owner.
6. `Store.save_automate_blur` accepts only `'idle'` and `'tab_switch'` — passing `'screen_share'` is rejected. The API is opinionated and partial.
7. The resolve fold combines all three into `automate_blur_active / automate_blur_only / automate_blur_skipped`, but the input shape (per-host map vs. global record) means the resolve has bespoke logic per trigger.
8. SW restart resets `blsi_screen_share` and `blsi_automate_suppressed_tabs` but NOT `blsi_automate_blur`. Stale idle/tab_switch state can survive an SW eviction within the same browser session.
9. `onActive` clears both idle AND tab_switch atomically; per-trigger writes only ever clear themselves. Asymmetric.

---

## The flow we have today (recap)

For the full storage layout see `docs/storage-layout.md`. For the trigger-by-trigger detection see the discussion thread that produced this doc.

Three triggers, three detection paths, one resolve fold:

```
[Idle DOM events → setTimeout]      ──→ onIdle('idle')
                                        └→ Store.save_automate_blur(host,'idle',true)
                                           └→ chrome.storage.session.blsi_automate_blur[host].idle = true

[visibilitychange / window.blur]    ──→ onIdle('tab_switch')
                                        └→ Store.save_automate_blur(host,'tab_switch',true)
                                           └→ chrome.storage.session.blsi_automate_blur[host].tab_switch = true

[getDisplayMedia patch (MAIN)]      ──CustomEvent──→ port + sendMessage to background
                                        └→ background._setScreenShareActive(senderTabId)
                                           └→ chrome.storage.session.blsi_screen_share = {active, sharing_tab_id, ...}

All three:                          ──→ chrome.storage.onChanged
                                        └→ storage_model._on_change
                                           └→ content_script.handleStorageChange
                                              └→ Store.resolve()
                                                 └→ Engine.handleSite()
```

Live state lives in three session keys. Local-storage `automate.settings` carries user intent only.

---

## Trigger 1: Idle

Starting here.

### Current implementation — where everything lives

| Concern | File | Lines |
|---|---|---|
| User intent (settings) | `src/constants.js` `DEFAULT_MODEL.automate.settings.idle` | `{ value: 5, unit: 'min', enabled: false }` |
| Detection (DOM events + timer) | `src/auto_blur.js` | 32-50 (idle timer reset + `_handleActivity`) |
| Init / register | `src/auto_blur.js` `init()` + caller `content_script.applyState` | 121-144 / ~561-595 |
| Live state write | `content_script.js` `onIdle` callback | ~573-585 |
| Live state clear | `content_script.js` `onActive` callback | ~586-589 |
| Live state storage | `chrome.storage.session.blsi_automate_blur[host].idle` | (per-host boolean) |
| Live state cache mirror | `storage_model.js` `_automate_cache` | 37 |
| Resolve fold | `storage_model.js` `resolve()` | 670-697 (idle_raw / idle_eff) |
| Suppression scope | `blsi_automate_suppressed_tabs` (per-tab) | (no per-host suppression for idle) |

### Detection details

**Activity events** that reset the timer (registered in capture phase, `passive: true`):
```
'mousemove', 'keydown', 'scroll', 'touchstart'
```

**Timer**: a single `setTimeout(idleTimeout * 1000)`. On expiry: if `!_isIdle`, set `_isIdle = true` and fire `onIdle({reason: 'idle'})`. Reset on every activity event.

**Shared `_isIdle` flag** with tab_switch — only one can fire at a time per tab.

**Time bounds**:
- `value` valid range 1–99 (validated in `validate_model`).
- `unit` is `'sec'` or `'min'` only — `'hr'` rejected because the legacy `chrome.idle` cap is ~3000 s; we kept the cap even though we now use DOM events instead.
- UI warns when `value*unit > 3000s`.

### Init / destroy lifecycle

`auto_blur.init` is called from `content_script.applyState`, gated by a config-key:
```js
const cfgKey = JSON.stringify({
  enabled: !!resolved.enabled,
  idle:    { enabled: !!idle.enabled, value: idle.value, unit: idle.unit },
  tab:     !!tab_switch.enabled,
});
if (cfgKey !== _autoBlurCfgKey) {
  _autoBlurCfgKey = cfgKey;
  if ((idle.enabled || tab_switch.enabled) && resolved.enabled) {
    blsi.AutoBlur.init({...});
  } else {
    blsi.AutoBlur.destroy();
  }
}
```

The cfg-key gate avoids restarting a live idle timer on unrelated storage echoes (e.g. blur_radius slider). But ANY change to `idle.value/unit` forces destroy + re-init → live `_isIdle` flag is lost.

### Storage shape today

```jsonc
// chrome.storage.session.blsi_automate_blur
{
  "github.com":      { "idle": true,  "tab_switch": false },
  "mail.google.com": { "idle": false, "tab_switch": true  },
  // entries with both false are stripped at write time
}
```

Per-host boolean. No timestamp, no "since when", no idle-trigger metadata.

### Resolve fold

```js
idle_raw  = !!_automate_cache[host]?.idle;
tab_supp  = has_tab_id && _suppressed_tabs.includes(tab_id);
idle_eff  = !tab_supp && idle_raw;
// ...
automate_blur_active = idle_eff || tab_switch_eff || ss_eff;
```

Idle has only one suppression vector: per-tab silence-all (`blsi_automate_suppressed_tabs`). No per-site, no per-feature for idle specifically.

### Toast / UI side effects

`content_script.applyState` → `onIdle` callback also handles toast firing:
- `_idleToastShown` — fires once per focused visit; reset on `visibilitychange → visible`.
- Toast shown only when `automate_blur_only` (i.e. idle is the SOLE reason for blur — no manual blur, no pick-blur).
- If `automate_blur_skipped` (manual or pick-blur already on), shows "skipped" toast instead.

### Quirks specific to idle

1. **DOM activity, not chrome.idle API.** We migrated away from `chrome.idle.setDetectionInterval` because it required the `idle` permission, was capped at 3000s, and reported "locked" states we didn't care about. The DOM-event approach is finer-grained but less robust against tabs in the background (no events fire when tab is in another window).
2. **Idle timer keeps ticking when tab is hidden** — `mousemove`/`keydown` etc. don't fire on hidden tabs, so an idle timer started before the user switched away will fire its timeout regardless. With `tab_switch` also enabled, the user has already been "automate-blurred" via tab_switch, so the late idle fire is suppressed by `_isIdle`. Without `tab_switch`, idle fires on a hidden tab — the user comes back and the page is blurred even though the timer expired while they were away.
3. **Per-host live state** but the timer itself is per-tab. If the user has two tabs on `github.com`, only ONE may be the "idle" tab — but the live state under `github.com` says yes, and `resolve()` for the OTHER tab also reads `idle:true` and would blur. Fortunately, the OTHER tab's content_script also has its own auto_blur instance with its own `_isIdle` and its own onActive that would clear on activity. But there's a window where both tabs blur because of one's idle.
4. **No timestamp / TTL.** If the user idles, then SW evicts, then user comes back — `idle:true` is still in session storage, but the `_isIdle` flag in auto_blur was lost when content_script reloaded. The page shows blurred until activity fires `onActive` (clears the flag). Brief desync between in-memory and session state.
5. **`onActive` clears tab_switch too.** Returning to active activity wipes both; semantically that's "user came back, they're using this tab now, no automate triggers should be live for this host".
6. **Toast suppression is per-content-script-instance** — `_idleToastShown` doesn't survive a reload. Tab reload while idle = toast may re-fire on next idle.

### Tests covering this

`tests/unit/auto_blur.test.js` — covers the timer + activity + tab_switch logic. Doesn't exercise content_script's onIdle/onActive callbacks (those are integration-level).

### Documented limitations

From `CLAUDE.md` Known Limitations table:
> Opening the extension popup briefly blurs the page when `automate.tab_switch` is on — `window.blur` fires when focus moves to the popup; auto_blur cannot detect own-extension focus from page context. 250 ms debounce filters short focus-pulls but the popup stays open longer.

(That's tab_switch-specific, listed here for completeness.)

### Decisions locked

#### D1. Storage shape — Shape 1 flat, 3 phases, **per-tab only**

One flat string-valued map in session storage. No per-host map. No metadata, no timestamps, no nesting.

**Phase enum** (single source of truth — TBD where; likely `constants.js`):
```
'off' | 'armed' | 'fired'
```

| Phase | Meaning |
|---|---|
| `off` | Feature disabled in settings, OR extension disabled, OR explicitly muted by the user |
| `armed` | Feature on, listener attached, timer counting; not yet fired |
| `fired` | Idle threshold exceeded; tab is currently auto-blurred due to idle |

**Storage layout** (replaces the per-host `blsi_automate_blur[host].idle` field):

```jsonc
"blsi_automate_idle_by_tab": {
  "184729322": "armed",
  "184729400": "fired"
  // tab ids that are 'off' may be absent (see D4 below)
}
```

One flat map keyed by tab id. Resolve reads only this map for idle.

**Why no per-host map** (decision rationale — keep alongside the shape):
- Idle is a per-tab concern. If Tab A (github.com) is idle and the user opens Tab B (github.com), the act of opening B IS activity — B should not blur. A per-host map would falsely propagate Tab A's idle state to B.
- The legacy per-host shape (`blsi_automate_blur[host].idle`) predates having a tab-id at resolve time. Now we have it; per-host adds nothing useful for idle.
- Screen-share is the exception (its per-host suppression is user-meaningful). For idle and tab_switch, per-tab is sufficient.

Suppression is no longer modeled as its own phase — it collapses into `off` (i.e. the user dismissing a toast writes `off` to the tab map). The "why off" detail (settings vs user-dismissed) is not in the live state; if needed for UI, it lives in a separate "user_dismissed" record outside this enum.

This decision also means **D2 (per-tab vs per-host coordination) and D3 (resolve precedence) are no longer applicable** — there's only one map. They drop off the open list below.

### Still pending — to settle next

#### ~~D2. Per-tab vs per-host coordination~~ — **N/A** (no host map)

#### ~~D3. Resolve precedence~~ — **N/A** (no host map)

#### D4. Implicit absence

Does "no entry in the map" mean `off`, or does it mean `armed` (with the entry only being written on transitions)?

- **(a) Absence = off.** Writes happen on every transition (off→armed, armed→fired, fired→armed, etc.). Highest write volume, cleanest semantics.
- **(b) Absence = armed (when feature enabled).** Only `fired` and `off` (suppressed) are written. Resolve checks settings to disambiguate. Low write volume; trickier resolve.
- **(c) Absence = nothing-known.** Resolve defaults to `off` if absent. Same as (a) effectively, but the writer doesn't have to write `armed` on init — only on `fired` transition. New tab opens → no entry → effectively `armed` because settings.idle.enabled=true → resolve treats as armed.

- **Decision**: _pending_

#### D5. Owner

- **(a) Content script writes both maps.** Same as today's writer. Simplest.
- **(b) Background owns both maps.** Symmetric with screen_share. Content sends `IDLE_FIRED { tab_id, hostname }` / `IDLE_CLEARED` messages; background does the writes. SW-eviction-safe because writes are idempotent.
- **(c) Split — content writes tab map, background writes host map.** Coordinator pattern.

- **Decision**: _pending_

#### D6. Detection mechanism

Keep DOM events (current approach), or switch to `chrome.idle` (needs permission, OS-level granularity, 15s minimum), or hybrid?

- **Decision**: _pending_ — leaning DOM-events based on the rationale captured below.

#### D7. Stale-entry / TTL handling

Without timestamps in the value, we can't TTL via timestamp comparison. Options:
- **(a) None.** Stale entries persist until next browser-close (session storage wipes them).
- **(b) `chrome.tabs.onRemoved`** strips closed tab ids from the tab map (mirrors what we do today for `blsi_automate_suppressed_tabs`).
- **(c) Periodic sweep.** Background runs a janitor on alarms — too heavy for the use case.

(b) is essentially free. Recommend including by default.

- **Decision**: _pending_

#### D8. Coupling with tab_switch

Idle and tab_switch currently share `_isIdle` inside `auto_blur.js`. Once we split storage per trigger, do we also split the in-memory flag?

- **(a) Keep `_isIdle` shared.** "Auto-blurred for any reason" is one state in the timer; storage records which trigger caused it.
- **(b) Split — `_isIdle_by_inactivity` + `_isIdle_by_focus_loss`.** Both can be true simultaneously; ON-active clears whichever was set by the actual cause.

- **Decision**: _pending_ — defer until we look at tab_switch.

#### D9. Cfg-key gating

Currently any change to `idle.value/unit` destroys + re-inits auto_blur, losing live `_isIdle`. After redesign, do we hot-update the timeout?

- **Decision**: _pending_

#### D10. Toast UX (`_idleToastShown`)

Same question as before — per-content-script-instance (current; resets on reload), or persisted to session storage so reload doesn't re-toast.

- **Decision**: _pending_

### Constraints we should respect (regardless of redesign)

- **No new permissions** unless we deliberately decide we need them. `idle` permission is currently NOT required.
- **Stay in vanilla JS / IIFE pattern** — no bundler.
- **Backward-compatible storage migration** — `validate_model` + `_normalize_*` helpers in `storage_model.js` must accept old shapes and rewrite to new shape. Don't break upgrade path for existing users.
- **Same-commit doc updates** — `docs/contracts/storage_model.md`, `docs/contracts/auto_blur.md`, `CLAUDE.md` Settings Shape section, `docs/storage-layout.md`.
- **Test coverage** — `tests/unit/auto_blur.test.js` and `tests/unit/storage_model.test.js` need updates for any storage-shape change.
- **MV3 service worker** — anything moved to background must tolerate SW eviction. State must be in `chrome.storage.session` (or local) — not module-level variables.
- **Multi-tab semantics** — whatever we land on, decide explicitly whether two tabs on the same host share automate state.

---

## Trigger 2: Tab switch

### Detection recap

Two browser-event sources, both fold into one trigger via `auto_blur.js`:

- `document.visibilitychange` (in-window tab switch — sibling tab focused) — 150ms debounce filters tab-drag-to-new-window.
- `window.blur` / `window.focus` (cross-window — alt-tab to another app, popup open) — 250ms debounce filters URL-bar / quick-focus-pulls.

No timer / no countdown — state flips on event.

### Decisions locked

#### TS1. Storage shape — same as idle (3 phases, per-tab only)

**Phase enum** identical to idle:
```
'off' | 'armed' | 'fired'
```

| Phase | Meaning |
|---|---|
| `off` | Feature disabled, OR extension disabled, OR explicitly muted |
| `armed` | Feature on, listeners attached, page visible AND window focused — watching |
| `fired` | Page hidden OR window unfocused — auto-blurred |

**Storage layout** (replaces the per-host `blsi_automate_blur[host].tab_switch` field):

```jsonc
"blsi_automate_tab_switch_by_tab": {
  "184729322": "armed",
  "184729400": "fired"
}
```

Single flat map keyed by tab id. No per-host map. Same rationale as idle:
- Tab-switch is fundamentally per-tab (a tab is hidden or its window is unfocused).
- A sibling tab on the same host being visible doesn't mean the hidden tab should unblur or vice versa.
- `window.blur` legitimately marks ALL tabs in that window as `fired` simultaneously (each writes its own entry); resolve in each tab reads its own value.

#### TS2. Sub-state granularity

Single `fired` value — no `fired_visibility` / `fired_window_blur` distinction. Idle has only one cause; tab_switch has two but the user-facing semantic is "the tab isn't actively being looked at" — cause doesn't matter for blur engagement. If we ever need to debug or branch in toast logic, add an aux field elsewhere; don't pollute the phase enum.

#### TS3. Debounce / pending state

Debounce windows (150ms / 250ms) are in-memory in `auto_blur.js`. No `pending` phase in storage. Storage only records committed transitions.

### Still pending — to settle alongside idle

These mirror the idle pending list (D4-D10). Decisions made for idle should apply uniformly unless we identify a specific reason to diverge:

- **TS4. Implicit absence** — same question as idle D4 (does "no entry" mean `off`, `armed`, or "fall through"?).
- **TS5. Owner** — content / background / split (mirrors idle D5).
- **TS6. Stale cleanup** — `chrome.tabs.onRemoved` strips closed tab ids (mirrors idle D7).
- **TS7. Coupling with idle (`_isIdle` shared flag in auto_blur.js)** — split or shared (was idle D8). This is the one decision that's specific to the idle/tab_switch coupling and not a one-to-one mirror.
- **TS8. Cfg-key gating** — current init/destroy on every settings change loses live state (mirrors idle D9).
- **TS9. Toast persistence** — currently `_idleToastShown` is per-instance (was idle D10).

### Tab-switch-specific quirks worth preserving (or fixing)

- **Window-blur write storm**: 10 tabs in one window all see `window.blur` simultaneously. With per-tab writes, that's 10 storage writes inside the 250ms debounce. Chrome's storage layer batches but cross-context contention is real. Mitigation if it bites: background owns the write and broadcasts (TS5 = background owner).
- **Popup-open false positive**: opening the extension popup itself triggers `window.blur` on the page → tab_switch fires → page blurs while user adjusts settings. Already documented in CLAUDE.md known limitations. The 250ms debounce mitigates short pulls but the popup typically stays open longer. Out of scope for this redesign; revisit if the new owner model gives us a way to detect "focus moved to our own popup".

---

## Trigger 3: Screen share

_Not yet started. To be filled in after tab_switch is settled._

Capture: 5-layer relay (MAIN bridge → screen_share.js → port + sendMessage → background → session record), gating asymmetry, port lifetime, sharing_tab_id race, suppressed_sites scope, decisions.

---

## Cross-trigger redesign principles

### Architectural decision — `src/automate/` module

Folder name: **`src/automate/`** (matches existing config namespace `automate.settings.*` and storage keys `blsi_automate_*`).

All three triggers move into a new `src/automate/` directory. Replaces `src/auto_blur.js` (deleted) and `src/screen_share.js` (folded in). Listener-based, observer-pattern. Each observer:
- self-contained event registration (no caller wiring up listeners)
- writes its own state to session storage via shared helpers
- exposes `init()` / `destroy()` / `getCurrentPhase()` (where applicable)

**File layout**:
```
src/automate/
  state.js          — blsi.Automate.State; phase enums + storage keys + read/write helpers; loaded in BOTH contexts
  overlay.js        — blsi.Automate.Overlay; viewport-covering DOM rectangle primitive; loaded in content
  idle.js           — blsi.Automate.Idle; chrome.idle.onStateChanged listener; loaded in background only
  visibility.js     — blsi.Automate.Visibility; Page Lifecycle observer; loaded in content only
  screen_share.js   — blsi.Automate.ScreenShare; split content + background; replaces src/screen_share.js
```

Module name pattern: `blsi.Automate.<TriggerOrPrimitive>` matches config path `automate.settings.<trigger>` so a reader connects them instantly.

**Registration**:
- `background.js` does `importScripts('src/automate/state.js', 'src/automate/idle.js', 'src/automate/screen_share.js')` then calls `Idle.init()` and `ScreenShare.initBackground()` at top-level.
- Manifest `content_scripts` loads `state.js` + `overlay.js` + `visibility.js` + `screen_share.js` (in that order, before `content_script.js`). `content_script.init` calls `Visibility.init({tab_id})`, `ScreenShare.initContent()`, and `Overlay.init()`.

**API choices** (locked):
- **Idle** — `chrome.idle` API only. No DOM-event fallback. Single global string in storage. Adds `"idle"` permission. 15s minimum (UI clamp). Hot-update via `chrome.idle.setDetectionInterval(seconds)` when user changes threshold — no destroy/re-init.
- **Tab-switch** — Page Lifecycle abstraction (`active` / `passive` / `hidden` / `frozen`) over `visibilitychange` + `focus` + `blur`. Per-tab map. No permission cost.
- **Screen-share** — refactor existing 5-layer relay into `Automate.ScreenShare`, no behavioral change. Adds folder-level co-location.

### Render path — overlay primitive (NEW)

**Automate-driven blur uses a viewport overlay, not the stamp+CSS engine.**

When automate state requires blur, `blsi.Automate.Overlay` shows a single full-viewport `<div>` (`position: fixed; inset: 0; z-index: huge`). When state clears, the div is hidden / removed.

```
              ┌──────────────────────────────────┐
              │  page (untouched)                │
              │  ┌────────────────────────────┐  │
              │  │ <div class="bl-si-auto-    │  │
              │  │      overlay">             │  │
              │  │   covers entire viewport   │  │
              │  │   semi-opaque OR blurred   │  │
              │  └────────────────────────────┘  │
              └──────────────────────────────────┘
```

**Why an overlay instead of stamp+CSS injection**:
- Cheap: 1 DOM element vs `querySelectorAll('*')` + per-element data-attribute stamping + per-shadow-root CSS injection.
- Privacy-positive: covers absolutely everything (including canvas, video, iframes — anything underneath, regardless of category settings).
- Symmetric: automate intent is "hide this page now"; an opaque curtain matches the intent more honestly than a CSS filter that may leave artifacts.
- Dynamic: changing color/opacity/blur is a CSS variable update on one element. No page-wide reflow.

**Render modes** the overlay can take:
- `solid` — opaque color (fast, deterministic; no part of the page leaks through)
- `frosted` — `backdrop-filter: blur(N)` over a translucent tint (lets users see vague shapes without legible content)
- `color` — solid color from `pick_blur_color` settings (matches user's existing blur preferences)

**What the overlay does NOT do**:
- Doesn't stamp `[data-bl-si-blur]` on anything.
- Doesn't inject `<style>` blocks that participate in the cascade.
- Doesn't observe DOM mutations.
- Doesn't touch shadow roots — sits on top of everything via z-index.
- Doesn't interact with PII / pick-blur / manual blur engines (those run independently for their own intents).

**When overlay shows** (resolved at handleSite):
- `automate_blur_active && !manual_blur && !pick_blur_present` → show overlay (current `automate_blur_only` semantic).
- `automate_blur_active && (manual_blur || pick_blur_present)` → still show overlay (automate is a stronger statement than partial blur).
- `!automate_blur_active` → hide overlay.

(Exact rule TBD — current code marks this as "skipped". Worth re-evaluating with the overlay model.)

### Engine = pure storage-event reader (NEW)

The blur engine becomes **read-only with respect to imperative calls**. All state transitions originate from storage events:

```
[any source: idle observer, visibility observer, screen_share observer, popup, picker]
   └→ writes session/local storage
        └→ chrome.storage.onChanged fires (every tab + background)
             └→ blsi.Model._on_change → content_script.handleStorageChange
                  └→ Store.resolve()
                       └→ Engine.handleSite(resolved)   ← only entry point that drives DOM
```

`Engine.handleSite` becomes the single mutation surface. Picker callbacks, shortcuts, popup — all write to storage and let the storage event drive the engine. No more `await _sync()` after every storage write — the storage write itself IS the trigger.

Currently `_sync()` is called both implicitly (via `handleStorageChange`) AND explicitly (after every `Store.*` write in content_script). The redesign drops the explicit calls. Storage onChanged is the single dispatcher.

**Implication for `Automate.Overlay`**: the overlay's show/hide also runs inside `handleSite` (or a sibling reconcile that handleSite calls). Overlay reads `resolved.automate_blur_active` — does not subscribe to storage directly.

### Class shape — `blsi.Automate`

Single namespace, modules attach. IIFE pattern preserved (CLAUDE.md requirement).

```js
blsi.Automate = {
  // Phase enums + storage key constants + read/write helpers (state.js)
  State: {
    PHASES: { idle: {active, idle, locked}, tab_switch: {armed, fired, off} },
    KEYS: { idle, tab_switch_by_tab, screen_share, suppressed_tabs },
    write_idle(state),
    write_tab_switch(tab_id, phase),
    clear_tab_switch(tab_id),
    read_idle(),
    read_tab_switch(tab_id),
  },

  // Per-context observers (each registers its own listener)
  Idle:        { init(), destroy(), setThreshold(seconds) },         // background only
  Visibility:  { init({tab_id}), destroy(), getCurrentPhase() },     // content only
  ScreenShare: { initContent(), initBackground(), destroy() },       // both contexts

  // The render primitive (content only)
  Overlay: {
    init(),                                       // no-op until show()
    show({ mode, color, opacity, blur_radius }), // mounts the div if not mounted
    hide(),                                       // removes the div
    update({ ... }),                              // re-applies CSS vars
    isVisible(),
  },
}
```

**Storage shape after Lifecycle module**:
```jsonc
"blsi_automate_idle":              "active" | "idle" | "locked"   // global; written by background
"blsi_automate_tab_switch_by_tab": { "<tab_id>": "armed" | "fired" }  // per-tab; written by content
"blsi_screen_share":               { active, sharing_tab_id, started_at, suppressed_sites }  // unchanged
"blsi_automate_suppressed_tabs":   [tab_ids…]                          // unchanged
```

Note: idle's per-tab map locked earlier (D1) is **superseded** because chrome.idle is OS-level by definition. Per-tab idle made sense only with DOM-event detection. With chrome.idle, one global string is correct.

**Listeners only — zero polling**:
| State | Listener | Context |
|---|---|---|
| Idle | `chrome.idle.onStateChanged` | background |
| Tab-switch | `visibilitychange` + `focus` + `blur` | content |
| Screen-share start | CustomEvent `__blsi_screen_share` | content (relays to background) |
| Screen-share end | port `onDisconnect` OR CustomEvent | background + content |
| Cache invalidation | `chrome.storage.onChanged` | both |

No `setTimeout`-driven polling. No hand-rolled debounces. The chrome.idle interval IS the debounce; Page Lifecycle state computation is event-instant.

### What dies in the refactor

- `src/auto_blur.js` (entire file).
- `src/screen_share.js` (content side moves into `ScreenShareObserver.initContent()`).
- Background `_setScreenShareActive` / `_setScreenShareInactive` / `_sharePorts` map (move into `ScreenShareObserver.initBackground()`).
- `_autoBlurCfgKey` gate in `content_script.applyState` — idempotent state writes obviate destroy/re-init churn.
- Shared `_isIdle` flag — two independent observers, two independent storage entries.
- 150ms visibility / 250ms window-blur hand-rolled debounces.
- `_idleToastShown` per-instance flag — replaced by toast logic that observes the new global idle key transition.

### What stays

- `src/main_world_bridge.js` — `getDisplayMedia` patch unchanged; dispatches CustomEvent.
- `Store.resolve()` — fold reads from new keys but remains the convergence point.
- Toast surface in `content_script.js` — reads `blsi_automate_idle` from session storage; fires on `'active' → 'idle'|'locked'` transition.
- Existing per-tab suppression scope (`blsi_automate_suppressed_tabs`) — unchanged.

### Cross-trigger principles after the move

- [x] Unified storage convention — flat phase strings keyed by appropriate scope (global / per-tab / per-host record).
- [x] Unified ownership — observer per trigger; background owns global signals; content owns per-document signals.
- [x] Unified registration — single `init()` per observer; called once from background or content.
- [ ] Unified suppression model — still 3 scopes (`tab` / `site_session` / `feature`), 2 keys. Could fold into Lifecycle.State helpers; defer.
- [ ] Unified resolve fold — bespoke per trigger but reading from uniformly-shaped storage. Tighten if it gets ugly.
- [ ] Unified test pattern — TBD; tests likely split per observer.

### Permission impact (CWS)

Adds `"idle"` permission. Install-time warning text Chrome shows: "Detect when your computer is idle". Mild; not in the same league as host_permissions or `tabs`. CWS justification in privacy disclosure: "Blurry Site uses chrome.idle to automatically blur the page when your computer becomes idle or your screen is locked."

---

## Out of scope (for this redesign)

- Adding new automate triggers (e.g. mouse-leaves-window, prolonged scroll, etc.).
- Changing the user-facing settings UI / popup card layouts.
- Migrating the `automate` settings shape itself (the `local` storage side) — only the live `session` state is on the table.
- Unifying with the manual `blur_all.status` toggle — that's a separate concern.

---

## Change log

| Date | What | By |
|---|---|---|
| 2026-04-29 | Initial doc — captured current state for all three triggers; idle deep dive section started. | Claude |
| 2026-04-30 | Locked decisions: Shape 1 (3-phase `off/armed/fired`), per-tab only (no per-host), `chrome.idle` for idle, Page Lifecycle for tab-switch, `src/automate/` folder, `blsi.Automate` namespace, overlay primitive replacing stamp+CSS for automate intent, engine-as-storage-event-reader. | Claude |
| 2026-04-30 | Built foundation files (dormant — write only): `src/automate/state.js`, `overlay.js`, `idle.js`, `visibility.js` + matching contracts under `docs/contracts/automate/`. Manifest gained `"idle"` permission + 3 content scripts. `background.js` `importScripts` + `Idle.init()` at top-level. 801 tests green. | Claude |
| 2026-04-30 | Cutover step 1 — unit tests for the 4 dormant automate modules: `tests/unit/automate/{state,overlay,idle,visibility}.test.js` + matching `*.tests.md` contracts. Added `chrome.idle` mock to `tests/setup.js`. 80 new tests, 881 total, all green. | Claude |
| 2026-04-30 | Cutover step 2 — `validate_model` clamps `automate.settings.idle.value` to 15 when `unit==='sec'` and value<15 (chrome.idle floor). Same clamp applied to site_rule snapshot post-fill. constants.md + constants.tests.md updated. 6 new tests, 887 total, green. | Claude |
| 2026-04-30 | Cutover steps 3-6 + 8 — Visibility skips writing `'armed'` (D4: absence === armed); `storage_model.resolve()` reads idle/tab_switch via `blsi.Automate.State` instead of `_automate_cache`; legacy `save/patch/clear/get_automate_blur` API removed; `content_script.js` wires `Visibility.init({tab_id})` + `Overlay.init()` and drops the `AutoBlur.init` block; `engine.handleSite` shows/hides `Overlay` based on `automate_blur_active`; `popup_state.clearAutomateBlur` calls `State.clear_tab_switch(_tabId)`; `src/auto_blur.js` + contracts + tests deleted; manifest + background `_ISOLATED_WORLD_FILES` updated; popup UI clamp (step 8) was already in place. CLAUDE.md, src/CLAUDE.md, storage_model contract updated. 866 tests green. | Claude |

## Current state (paused for context handoff — 2026-04-30)

**Foundation = built and dormant.** New modules write to session storage; nothing yet reads them. Existing `src/auto_blur.js` + `src/screen_share.js` continue to drive behavior.

**Files added**:
```
src/automate/state.js                              — blsi.Automate.State (both contexts)
src/automate/overlay.js                            — blsi.Automate.Overlay (content)
src/automate/idle.js                               — blsi.Automate.Idle (background)
src/automate/visibility.js                         — blsi.Automate.Visibility (content)
docs/contracts/automate/state.md                   — 170 lines
docs/contracts/automate/overlay.md                 — 121 lines
docs/contracts/automate/idle.md                    —  96 lines
docs/contracts/automate/visibility.md              — 104 lines
docs/contracts/automate/state.tests.md             — test contract (29 tests)
docs/contracts/automate/overlay.tests.md           — test contract (18 tests)
docs/contracts/automate/idle.tests.md              — test contract (19 tests)
docs/contracts/automate/visibility.tests.md        — test contract (14 tests)
tests/unit/automate/state.test.js                  — 29 tests
tests/unit/automate/overlay.test.js                — 18 tests
tests/unit/automate/idle.test.js                   — 19 tests
tests/unit/automate/visibility.test.js             — 14 tests
docs/automate-redesign-plan.md                     — this doc
docs/storage-layout.md                             — full storage layout reference (542 lines)
```

**Files modified**:
```
manifest.json       — "idle" permission added; src/automate/{state,overlay,visibility}.js added to content_scripts
background.js       — importScripts state + idle; Idle.init() called at top-level; _ISOLATED_WORLD_FILES mirrors manifest
tests/setup.js      — added chrome.idle stub (setDetectionInterval / queryState / onStateChanged)
docs/contracts/background.md  — step 2 + invariants updated for automate imports + idle write
```

**Files NOT yet touched (cutover queue)**:
```
src/storage_model.js    — resolve() still reads old blsi_automate_blur[host].{idle,tab_switch} shape
src/engine.js           — handleSite() still uses stamp+CSS for automate; not yet wiring Overlay
src/content_script.js   — does not yet call Visibility.init({tab_id}); old auto_blur.init still wired
src/auto_blur.js        — alive; will be deleted at cutover
src/screen_share.js     — alive; content half will be folded into automate/screen_share.js (deferred)
src/constants.js        — automate.settings.idle.value validator allows < 15s; needs clamp for chrome.idle
popup/                  — idle threshold input has no 15s minimum; needs UI clamp
```

**Test status**: 866 green (was 887; -21 from `auto_blur.test.js` deletion / re-shape of `automate_blur` describe in `storage_model.test.js`). New runtime is fully wired and passing.

**Cutover queue**:
1. ~~Add unit tests for state / overlay / idle / visibility.~~ DONE 2026-04-30.
2. ~~`validate_model` clamps `automate.settings.idle.value` to >= 15s.~~ DONE 2026-04-30.
3. ~~`storage_model.resolve()` reads from `KEYS.idle` + `KEYS.tab_switch_by_tab`.~~ DONE 2026-04-30.
4. ~~`content_script.init()` calls `Visibility.init({tab_id})` + `Overlay.init()`.~~ DONE 2026-04-30.
5. ~~`engine.handleSite()` calls `Overlay.show / hide`.~~ DONE 2026-04-30.
6. ~~Delete `src/auto_blur.js`. Remove from manifest + `_ISOLATED_WORLD_FILES`.~~ DONE 2026-04-30.
7. Refactor `src/screen_share.js` content half into `src/automate/screen_share.js`. Move `_setScreenShareActive`/`_setScreenShareInactive` from `background.js` into the same file. **Deferred — revisit alongside screen-share trigger redesign.**
8. ~~Popup UI: clamp idle threshold input minimum to 15s.~~ Already in place via `_makeSliderSection('bl-auto-idle', ..., 15, 3600, ...)`.

**Open decisions still pending**:
- D4/TS4: implicit absence semantics (`'off'` vs `'armed'` for empty entries) — currently the code treats absence as `'off'`; defer formal lock until tests written.
- D5/TS5: owner — implicitly chose content for visibility, background for idle. ScreenShare still split.
- D6: detection mechanism — locked (chrome.idle).
- D8/TS7: `_isIdle` shared flag coupling — gone. Two independent observers, two independent storage entries. Decision implicit.
- D9: cfg-key gating — gone. `Idle.setThreshold` is a hot update; `Visibility` has no config knob.
- D10: toast persistence — deferred until step 5 lands.

**Pick up by**:
1. Reading this doc end-to-end.
2. Reading `docs/storage-layout.md` (full storage reference).
3. Reading `docs/contracts/automate/*.md` (4 contracts) + `*.tests.md` (4 test contracts).
4. Reading the four `src/automate/*.js` source files.
5. Running `npm run test:unit` to confirm 866 baseline.
6. Picking step 7 (screen-share fold) — only remaining item.
