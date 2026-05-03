# popup/popup_ui.js Contract

## Overview

`popup/popup_ui.js` exposes `BlurrySitePopupUI` — stateless DOM helpers used by `popup.js` and render modules. All inputs arrive as args; the module reads no extension state and never calls `blsi.Model.*` or `BlurrySitePopupState.*`.

Depends on: `chrome.storage.local` (theme persistence only), `chrome.runtime.getManifest` (version), `chrome.i18n.getMessage` (fallback when `blsi.ContentI18n` unavailable), `blsi.ContentI18n.t` (preferred i18n path).

---

## Public API

### applyTheme(theme)

**What:** Sets `data-theme` attribute on `<html>`. `theme === 'light'` → `data-theme="light"`; anything else → `data-theme=""` (dark default).

**Params:** `theme: 'dark' | 'light'`.

**Returns:** void.

**Side effects:** Mutates `document.documentElement` attribute. All theme swaps (colors, themed image assets) cascade from CSS custom properties in `theme.css` keyed off this attribute. No JS asset swap — `<span class="bl-header__logo">` and `<span class="bl-off-view__logo">` use `background: var(--bl-logo)`.

---

### toggleTheme()

**What:** Flips current theme and persists to `chrome.storage.local.blsi_popup_theme`.

**Params:** none.

**Returns:** void.

**Side effects:** Calls `applyTheme(next)` then writes `{ blsi_popup_theme: next }` to storage.

---

### showToast(key, opts?)

**What:** Renders a transient i18n toast in the popup. Auto-dismisses after 15s. Has a logo + close button (logo wired to `var(--bl-icon-32)` background; close wired once at `DOMContentLoaded`). Supports type-based tinted backgrounds.

**Params:**
- `key` (string) — i18n message key. Resolved via `blsi.ContentI18n.t(key)` when available, falling back to `chrome.i18n.getMessage(key, opts.substitutions) || key`.
- `opts` (object | undefined) — optional configuration:
  - `opts.type` (`'success' | 'error' | 'info'` | undefined) — adds `bl-toast--{type}` class for tinted background. `'success'` = green tint, `'error'` = red tint, `'info'` = amber tint. Omit or `undefined` for default styling.
  - `opts.substitutions` (any[] | undefined) — passed through to `chrome.i18n.getMessage` fallback only.

**Returns:** void.

**Side effects:** Strips previous type classes (`bl-toast--success`, `--error`, `--info`) before applying the new one. Sets `#bl-toast-msg` text, removes `hidden`, adds `is-visible`. Schedules a 15s timer to remove `is-visible`, then 220ms later sets `hidden=true`. Replaces any in-flight timer.

**Edge cases:**
- `#bl-toast` missing → no-op.
- `#bl-toast-msg` missing → falls back to setting `el.textContent` directly (loses logo + close on that toast).
- No `opts` or `opts.type` undefined → no type class added, default `--bl-raised` background.

---

### setHost(hostname)

**What:** Writes `hostname` into every `.bl-header__host` and `.bl-subpage__host` element. Empty string when `hostname` is falsy.

**Params:** `hostname` (string | null | undefined).

**Returns:** void.

---

### setVersion()

**What:** Stamps `v<manifest.version>` into `#bl-version`.

**Params:** none.

**Returns:** void.

**Edge cases:** No-op when `#bl-version` is absent.

---

### applyI18n()

**What:** Walks every i18n-tagged element and writes the resolved message to the appropriate destination:
- `[data-i18n="key"]` → `el.textContent`
- `[data-i18n-aria-label="key"]` → `el.setAttribute('aria-label', ...)`
- `[data-i18n-title="key"]` → `el.setAttribute('title', ...)`

A single element may carry any combination of the three (e.g. an icon button with both `data-i18n-aria-label` and `data-i18n-title` for accessibility + tooltip). Resolution uses `blsi.ContentI18n.t(key)` when available, falling back to `chrome.i18n.getMessage(key) || key`.

**Params:** none.

**Returns:** void.

**Edge cases:** Empty resolved message leaves the existing DOM text/attribute untouched (only assigns when `msg` is truthy). The inline HTML fallback (e.g. `aria-label="Close"` next to `data-i18n-aria-label="aria_subpage_close"`) survives if i18n resolution fails.

---

### renderPowerButton(enabled)

**What:** Toggles `is-off` class on `#bl-power`, updates its `title` (using `tt_power_disable` / `tt_power_enable` i18n keys), and shows/hides `#bl-view-main` vs `#bl-view-off`.

**Params:** `enabled` (boolean).

**Returns:** void.

**Edge cases:** Each affected element guarded — missing nodes are skipped silently.

---

### showView(viewId, isEnabled)

**What:** Switches between main view, off-state view, and sub-pages. Manages `bl-has-subpage` body class for the slide animation.

**Params:**
- `viewId` (string) — one of `'bl-view-main'`, `'bl-view-off'`, or any id in `SUB_VIEWS`.
- `isEnabled` (boolean) — only consulted when `viewId === 'bl-view-main'` (to decide between main and off-state). Pass `true` for sub-views.

**Returns:** void.

**Side effects:** Toggles `hidden` on main, off-state, every sub-view in `SUB_VIEWS`, and `#bl-view-restricted` (always re-hidden during ordinary nav so a stale restricted state never bleeds through). Adds/removes `bl-has-subpage` on `document.body`.

**Constants:** `SUB_VIEWS = ['bl-view-htb-modify', 'bl-view-automate-modify', 'bl-view-shortcuts', 'bl-view-site-rules', 'bl-view-general']`. Adding a sub-page requires extending this array.

---

### showRestrictedView()

**What:** Swaps the popup into the "page restricted" empty state used when the active tab's URL is one Chrome blocks all extensions from (Web Store, chrome://, etc.). Mutually exclusive with main / off / sub-views; intended to be called once during popup boot only — normal navigation never targets it.

**Params:** none.

**Returns:** void.

**Side effects:** Hides `#bl-view-main`, `#bl-view-off`, and every sub-view in `SUB_VIEWS`; un-hides `#bl-view-restricted`; clears `bl-has-subpage` from `document.body`.

**Edge cases:** Each `getElementById` is guarded — missing nodes are skipped silently.

---

### updateClearAll(settings, blurItems, isPageBlurred)

**What:** Disables `#bl-clear-all` when there is nothing to clear (no blur-all on current host AND no pick-and-blur items).

**Params:**
- `settings` (object) — current resolved settings (only checked for truthiness; the function early-returns when settings is falsy).
- `blurItems` (Array) — current host's pick-and-blur items.
- `isPageBlurred` (boolean) — blur-all state for current host.

**Returns:** void.

**Edge cases:** No-op when `#bl-clear-all` absent or `settings` falsy.

---

## Module-private state

| Name | Type | Purpose |
|---|---|---|
| `_toastTimer` | `number \| null` | Active toast timer id; cleared and replaced on every `showToast` / `_dismissToast` call. |
| `SUB_VIEWS` | `string[]` | Enumerates sub-view ids managed by `showView`. |

`_dismissToast()` is private and wired once to `#bl-toast-close` via `DOMContentLoaded`. It is not exported.

---

## Invariants

1. **Stateless w.r.t. extension state** — never calls `blsi.Model.*` or `BlurrySitePopupState.*`. Inputs come only via args; the only persistent write is the theme key in `toggleTheme()`.
2. **No render-file imports** — popup_ui is a peer of render files, not a consumer; render files do not depend on it.
3. **Theme is CSS-token-driven** — `applyTheme` only flips `data-theme`. Asset swaps for theme (logos, icons) live in `theme.css` as `--bl-*` custom properties; popup_ui never sets `<img src>` or `background-image` directly.
4. **i18n via `blsi.ContentI18n.t` with `chrome.i18n.getMessage` fallback** — used by `showToast`, `applyI18n`, and `_t` (for power button title).
5. **DOM-id contract** — these ids must exist in `popup.html`: `#bl-toast`, `#bl-toast-msg`, `#bl-toast-close`, `#bl-version`, `#bl-power`, `#bl-view-main`, `#bl-view-off`, `#bl-clear-all`, plus every id in `SUB_VIEWS`. Each accessor guards individually so a missing optional id is a no-op rather than a throw.
