# Privacy Policy — BlurrySite

## Summary

BlurrySite does not collect, transmit, or share any user data. The
extension makes **zero network requests** of its own. All settings and
state are stored locally on your device and never leave your browser.

## What data is stored

BlurrySite stores all state in your browser's local extension storage.
Two namespaces are used:

### `chrome.storage.local` (persists across browser restarts)

| Key | Contents | Why |
|---|---|---|
| `blsi_model` | Single object holding all your settings: blur radius, reveal mode, blur categories, keyboard shortcuts, blur-all status, pick-and-blur items per hostname, auto-detect-PII configuration, automate trigger configuration, and any custom site rules you create. | Core state — without it the extension can't restore your setup on the next page load. |
| `blsi_debug` | Boolean — whether the extension's verbose logger is enabled. | Off by default. You can flip it for diagnostics. |
| `blsi_popup_theme` | `'dark'` \| `'light'` for the popup. | UI preference. |
| `welcome_dismissed` | Boolean — whether the first-run welcome modal has been dismissed. | Prevents the welcome screen from reappearing after the first visit to the popup. |
| `blsi_pwa_hint_shown` | Boolean — whether the PWA settings-access hint has been shown. | Prevents the hint from reappearing after the first display. |

### `chrome.storage.session` (cleared when the browser closes or crashes)

| Key | Contents | Why |
|---|---|---|
| `blsi_automate_idle` | `{ status, ignore_tabs, ignore_sites }` — OS idle phase (`'active'` / `'idle'` / `'locked'`) plus per-tab and per-site ignore lists. | Mirrors the OS idle state so blur applies when you step away. |
| `blsi_automate_tab_switch_by_tab` | `{ status: { [tab_id]: 'fired' }, ignore_tabs, ignore_sites }` — per-tab phase map plus ignore lists. | Tracks which tabs have triggered the tab-switch automate rule for the current session. |
| `blsi_screen_share` | `{ [tab_id]: { streams: { [stream_key]: { started_at } }, suppressed_sites } }` — per-tab, per-stream map. | Tracks in-progress screen-shares so other tabs can blur while you present. |
| `blsi_automate_suppressed_tabs` | Array of tab IDs you silenced via the "This tab" toast. | Per-session silence list. |
| `blsi_automate_suspended` | `{ idle, tab_switch, screen_share }` — boolean per trigger. | Tracks which automate triggers are temporarily suspended via the popup master toggle. |

This data never leaves your browser.

## What data is NOT collected

- No personal information.
- No browsing history (hostnames are used **locally** as keys for
  per-site state — never transmitted).
- No page content, screenshots, or page text. The page text is read
  in-memory for the optional auto-detect-PII feature, but matches are
  wrapped locally and never copied off-device.
- No analytics or telemetry.
- No cookies, fingerprints, or tracking identifiers.

## Network requests

BlurrySite issues **zero network requests** at runtime. The only
network traffic involving the extension is the initial download of
the extension package itself from the Chrome Web Store / Firefox AMO,
which is governed by those vendors' privacy policies.

There is no:
- Telemetry endpoint.
- Crash reporter.
- Update check beyond the browser's built-in extension auto-update.
- Remote configuration fetch.
- CDN font / asset request — fonts are bundled and loaded from
  `chrome-extension://` URLs.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Save your blur settings + state locally (the keys listed above). |
| `activeTab` | Apply blur to the page in the currently active tab. |
| `tabs` | Detect navigation + tab-switch events to restore blur on the right tab and to power the optional tab-switch automate rule. |
| `contextMenus` | Add "Blur this element" / "Unblur this element" to the right-click menu. |
| `scripting` | Re-inject the content scripts on existing tabs at install / update / reload. |
| `idle` | Power the optional "blur when idle" automate rule via `chrome.idle.onStateChanged`. |
| `<all_urls>` (host permission) | Required to apply blur on any website you visit — the extension does nothing on URLs you don't visit. Chrome / Firefox-blocked URLs (chrome://, the extension store, devtools, etc.) are never injected into. |

## Page-level capabilities (no extra permissions required)

For technical completeness:

- A small bridge script runs in the page's main JavaScript world to
  detect when **you** start screen-sharing via
  `navigator.mediaDevices.getDisplayMedia`. The detection is local; no
  data about the screen-share is recorded beyond the in-memory session
  flag listed above. When you stop sharing, the flag is cleared.
- The same bridge listens for `Element.prototype.attachShadow` calls
  so the blur engine can find late-attached shadow roots. Nothing is
  transmitted; this is purely a local DOM hook.

## Data deletion

Your data can be removed at any time:

- **Total**: uninstalling the extension automatically removes every
  storage key listed above. Nothing persists outside the browser.

## Data sale or sharing

I do not sell, rent, share, or transmit any user data. Ever. There
is no party with whom data could be shared because data never leaves
your device in the first place.

## Source code + reproducibility

BlurrySite is open source under [GPL-3.0-or-later](LICENSE). The
source matches the published extension byte-for-byte because there is
no build step that transforms code (vanilla JavaScript, no bundler).
You can audit the published version against the tagged release commit
in [the GitHub repository](https://github.com/ChennakeshavaG/blurrysite).

## Changes to this policy

Material changes to this policy will be reflected by bumping the
"Last updated" date at the top of this file.

## Contact

Questions, concerns, or reports about this privacy policy:

- Open an issue: https://github.com/ChennakeshavaG/blurrysite/issues
- Security-sensitive matters: see [`SECURITY.md`](SECURITY.md) for the
  private disclosure channel.
