# toast Contract

## Overview

In-page toast surface. Renders the floating `.bl-si-toast` element used by shortcuts (`shortcut_handler`), automate triggers (`automate/manager`), the picker, and the catch-up flow in `content_script`. Single-slot — a new toast replaces the previous one unless that one is marked persistent.

Distinct from the popup toast (`popup/popup_ui.js` → `.bl-toast`). The two share **no DOM, no state, and no lifecycle**: popup toast lives in the extension's popup window, this one lives in the host page. They have different CSS class prefixes (`bl-toast` vs `bl-si-toast`) and different auto-dismiss semantics.

## Module State

| Variable | Description |
|---|---|
| `_current` | `HTMLElement \| null` — the live toast element. `null` when no toast is on screen. |

## Public API

### show(text, duration?, actions?, opts?)

**What**: Shows a floating notification at the bottom of the page.

**Params**:
- `text` (string) — main message text.
- `duration` (number, optional) — milliseconds before auto-dismiss. Default `10000`. Ignored when `opts.persistent` is true.
- `actions` (Array<{label, onClick, variant?, tooltip?}>, optional) — action buttons in a second row. `variant: 'warn'` renders amber. `tooltip` sets `data-tooltip` on the button (CSS `::after` pseudo-element tooltip via `content.css`, not native `title`).
- `opts` ({persistent?: boolean, override?: boolean}, optional):
  - `persistent` truthy → skips the auto-dismiss timer (toast stays until user clicks close or an action button) AND blocks replacement by subsequent non-persistent toasts.
  - `override` truthy → forces replacement of any current toast, even a persistent one. Higher-priority callers (e.g. screen-share) use this to claim the slot from a lower-priority persistent toast (e.g. an idle persistent toast already on screen). Without `override`, a persistent toast cannot be replaced.

**Returns**: `HTMLElement` — the toast element (or `undefined` if a persistent toast already owns the slot AND `override` was not passed).

**Side effects**:
- If a non-persistent toast is on screen, it is removed synchronously and replaced.
- If a persistent toast is on screen and the new call did NOT pass `override: true`, the new call is silently dropped (returns `undefined`).
- If a persistent toast is on screen and the new call passed `override: true`, the existing toast is removed synchronously and replaced.
- Appends `<div class="bl-si-toast" role="status" aria-live="polite">` to `document.body`.
- Close button `aria-label` resolves via `chrome.i18n.getMessage('aria_toast_dismiss')` with English fallback `'Dismiss'`.
- Action button `onClick` fires after the toast animates out (`_dismiss(toast)` runs first).

**Handles**:
- Action items with missing `label` or non-function `onClick` are skipped.
- `chrome.runtime.getURL` guarded for test environments — logo skipped when unavailable.
- `chrome.i18n` guarded — falls back to English `'Dismiss'`.

### dismiss()

**What**: Animates out and removes the live toast (persistent or not). No-op if no toast is showing.

**Params**: none

**Returns**: `void`

**Side effects**: Adds `bl-si-toast--exiting`, removes after 250ms, clears `_current`.

### clearIfTransient()

**What**: Tear-down hook called by content_script disable paths. Removes the live toast **only when it is not persistent** — persistent toasts (e.g. the screen-share live toast) survive teardown so the user can still dismiss/act on them.

**Params**: none

**Returns**: `void`

**Side effects**: Synchronously removes the non-persistent `_current` from DOM (no exit animation) and clears the auto-dismiss timer. Persistent toasts are left in place.

## Internal Functions

### _dismiss(toast)

**What**: Animates a toast out and removes it.

**Side effects**: Clears `_removeTimer`, adds `bl-si-toast--exiting`, removes after 250ms, clears `_current` if it matched.

## Invariants

- **One toast at a time.** `show` replaces a non-persistent live toast synchronously; a persistent live toast cannot be replaced.
- **Persistent flag is one-shot per toast.** Set on the element via `toast._persistent = true` at creation; never mutated afterwards.
- **Override is per-call.** Only the call passing `override: true` can replace a persistent live toast; the `override` flag is NOT stored on the element. Use sparingly — it's intended for higher-priority transitions (screen-share rising edge) replacing lower-priority persistent toasts (idle persistent).
- **No auto-dismiss when persistent.** `_removeTimer` is not set; the toast lives until `dismiss()` or a user action.
- **Stateless across teardown.** `clearIfTransient` is the only safe path during shortcut/content_script teardown — it preserves persistent toasts deliberately.
- **No coupling to popup toast.** This module never reads or writes `#bl-toast` (popup id). Likewise `popup_ui.js` never reaches into `.bl-si-toast`.

## CSS classes (must match `styles/content.css` and `src/constants.js > css.toast*`)

| Class | Purpose |
|---|---|
| `bl-si-toast` | root |
| `bl-si-toast__top` | top row (logo + message + close) |
| `bl-si-toast__logo` | logo image |
| `bl-si-toast__message` | message span |
| `bl-si-toast__close` | close button (`✕`) |
| `bl-si-toast__actions` | action button row |
| `bl-si-toast__action` | action button (default styling) |
| `bl-si-toast__action--warn` | amber variant |
| `bl-si-toast--exiting` | fade-out animation hook |

## Callers

| Caller | Use |
|---|---|
| `shortcut_handler.js` | "Blurry Site — <action>" toast on shortcut fire |
| `automate/manager.js` | idle / tab_switch / screen_share transition toasts |
| `content_script.js` | catch-up toast for tabs opened mid-automate; PWA hint |
| `picker.js` | "Area too small" warning |
