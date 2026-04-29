# Chrome Web Store Listing — Blurry Site

> Copy-paste reference for the Chrome Web Store dashboard. Each section maps to a form field on the developer console. Source-of-truth facts are pulled from `manifest.json`, `_locales/`, `PRIVACY_POLICY.md`, and `docs/cws-audit.md`.

---

## Header

| Field | Value |
|---|---|
| Extension name | **Blurry Site** |
| Version | **0.69** |
| Manifest version | **3** |
| Default locale | `en` |
| Localized | `en`, `hi_IN`, `ta_IN` |
| Category (primary) | Privacy |
| Category (secondary) | Productivity |
| Languages distributed to | English, Hindi, Tamil (worldwide) |

---

## English listing (primary)

### Short description (115 chars — limit is 132)

```
Blur anything on any webpage — text, images, video, forms. Picker, shortcuts, auto-blur on screen-share. All local.
```

### Detailed description

```
Blurry Site hides anything on any webpage — text, images, video, form fields, whole layout blocks — with one keystroke or one click. Built for screen-sharing, presentations, demos, recordings, and over-the-shoulder privacy.

BLUR ALL  ·  Alt+Shift+B
Toggle blur on every supported element on the page. Five element categories — text, images & video, forms, tables, layout blocks — are individually toggleable, so you can hide visuals while leaving text readable, or vice-versa.

PICK & BLUR  ·  Alt+Shift+P
Three picker modes:
  • Dynamic — tap an element, blur follows it as the page changes.
  • Area on page — draw a rectangle that scrolls with the document.
  • Area on screen — draw a rectangle pinned to the viewport. Built for screen-sharing.

SIX BLUR STYLES
Blur, frosted glass, redacted bar, censored mosaic, solid color, and starred (asterisk fill). Pick one per feature.

AUTO-DETECT PII
Email addresses and numeric patterns (cards, phone-like groups, currency amounts) are detected and blurred without manual targeting — even when blur-all is off.

AUTOMATE
Auto-blur on idle (configurable seconds or minutes), on tab-switch, or the moment `getDisplayMedia` is called for screen-sharing. A tab-privacy mode replaces the tab title with `…` during a share.

REVEAL
Hover or click to peek at blurred content; release to re-blur. Reveal can also be disabled entirely.

SITE RULES
Pin a configuration — blur-all toggle plus a pick-and-blur snapshot — to a hostname or URL pattern. Visit the page, the right blurs are already there.

SCREENSHOT
Capture the visible viewport with blurs preserved and download as PNG.

KEYBOARD SHORTCUTS
Every action is remappable from the in-extension settings page. Defaults: Alt+Shift+B (blur all), Alt+Shift+P (picker), Alt+Shift+U (clear all), Alt+Shift+O (settings).

PRIVACY
Zero network requests. No analytics, no telemetry, no tracking. Everything stays in chrome.storage.local on your device. Open source: https://github.com/ChennakeshavaG/blurrysite

Works on Chrome 88+ and Firefox 109+.
```

---

## Localized short descriptions

> Verbatim openings of `manifest_description` from `_locales/<lang>/messages.json`, trimmed to fit the 132-character short-description limit. The full `manifest_description` (already shipping in the extension) can be reused as the localized detailed description.

### हिन्दी (hi_IN)

```
क्या कोई आपके पीछे झाँक रहा है — जानबूझकर या ग़लती से? किसी भी वेबसाइट पर जो चाहें धुंधला करें। कॉन्फ़िगर करें और भूल जाएँ।
```

Detailed description for hi_IN: use the full `manifest_description` value from `_locales/hi_IN/messages.json` verbatim.

### தமிழ் (ta_IN)

```
உங்கள் முதுகுக்குப் பின் பாருங்கள்! எந்த இணையதளத்திலும் வேண்டியதை மங்கச் செய்யுங்கள். ஒருமுறை அமைத்து மறந்துவிடுங்கள்.
```

Detailed description for ta_IN: use the full `manifest_description` value from `_locales/ta_IN/messages.json` verbatim.

---

## Permission justifications (privacy form)

> Reviewers ask for a per-permission rationale on the dashboard's privacy form. Every permission below has a real caller in the source — confirmed in `docs/cws-audit.md`.

### Single purpose

> Blurry Site lets users hide arbitrary content on web pages they visit, primarily to protect privacy during screen-sharing, presentations, and over-the-shoulder viewing.

### Per-permission rationale

| Permission | Why we ask | What the user gets |
|---|---|---|
| `storage` | Persist blur settings, per-site rules, picked elements, and keyboard shortcuts. | Settings survive browser restart. Per-site blurs auto-restore on every visit. |
| `activeTab` | Apply or clear blur on the tab the user is viewing when a shortcut fires or the popup opens. | Toolbar actions and shortcuts affect the page in front of you. |
| `tabs` | Detect navigation and tab-focus changes so blur state restores correctly across SPA navigations and tab switches; also drives auto-blur-on-tab-switch. | Blurred elements re-apply on the right URL. Auto-blur knows when the tab loses focus. |
| `contextMenus` | Add right-click "Blur this element" / "Blur selected text" entries. | One-click blur from the right-click menu without entering picker mode. |
| `<all_urls>` (host permission) | Blur is a per-page CSS/DOM operation; the extension cannot know in advance which sites the user wants to protect. | Works on every site — dashboards, social, banking, anywhere you might screen-share from. |

### Remote code

> The extension contains **no remote code**. All scripts are bundled. `fetch()` is used only with `chrome.runtime.getURL()` (extension-internal) or `data:` URLs. Confirmed by `docs/cws-audit.md`.

---

## Privacy disclosures (data-handling checkboxes)

> Mirror these answers in the dashboard's "Privacy practices" form. All "None" claims are enforced by the code: there is no network egress.

| Data type | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | — |
| Health information | No | — |
| Financial / payment information | No | — |
| Authentication information | No | — |
| Personal communications | No | — |
| Location | No | — |
| Web history | Not transmitted | Hostnames are used locally as keys for per-site blur state; never sent off-device. |
| User activity | Not transmitted | Idle / tab-switch / screen-share triggers are evaluated locally. |
| Website content | Not transmitted | CSS selectors of picked elements are stored locally only. |

### Certification statement

> All user data stays in `chrome.storage.local` (or `chrome.storage.session`, which is cleared when the browser closes) on the user's device. The extension makes no network requests, runs no analytics, and includes no third-party SDKs.

---

## Support links

| Purpose | URL | Source of truth |
|---|---|---|
| Primary support / feedback | https://gck.sh/blurrysite/feedback | Wired in `popup/popup.html` footer |
| Bug tracker | https://github.com/ChennakeshavaG/blurrysite/issues | Cited in `PRIVACY_POLICY.md` |
| Homepage / source | https://github.com/ChennakeshavaG/blurrysite | Cited in `PRIVACY_POLICY.md` |

---

## Screenshots plan

> The dashboard accepts up to 5 screenshots at **1280×800** (or 640×400). Image files are out of scope for this document — capture them and drop them under `store/screenshots/` when ready.

| # | Filename | Scene | What it sells |
|---|---|---|---|
| 1 | `01-blur-all.png` | Blur-all toggled on a busy SaaS dashboard. Toolbar shows the popup with the master switch on. | Hero shot — the one-keystroke promise. |
| 2 | `02-area-on-screen.png` | Picker active, "Area on screen" rectangle drawn over a chat panel during a fake screen-share. | Differentiator — viewport-pinned zones for screen-sharing. |
| 3 | `03-auto-screenshare.png` | Auto-blur firing the instant `getDisplayMedia` is called. Toast visible, page blurred. | The killer use-case most users install for. |
| 4 | `04-pii-detect.png` | PII auto-detect blurring credit-card numbers and emails in a Gmail-style inbox. | Works without manual targeting. |
| 5 | `05-shortcuts.png` | Keyboard shortcuts page with one action mid-rebind, capture-key dialog open. | Configurability + the in-extension settings UI. |

### Optional promo tiles

| Tile | Size | Content |
|---|---|---|
| Small promo tile | 440×280 | `icons/logo-light.svg` on the brand background, single-line tagline below. |
| Marquee promo tile | 1400×560 | Hero shot (#1 above) cropped, with three short feature callouts overlaid on the right third. |

---

## Submission checklist

Before clicking "Submit for review" in the dashboard:

- [ ] All warnings in `docs/cws-audit.md` (W1–W3) are resolved.
- [ ] `manifest.json` `version` matches the build artifact uploaded.
- [ ] `_locales/en`, `_locales/hi_IN`, `_locales/ta_IN` carry every i18n key referenced by popup and content scripts (no `__MSG_*__` placeholders rendering).
- [ ] Privacy form answers match the "Privacy disclosures" table above.
- [ ] Support URL on the dashboard matches the one wired in `popup/popup.html`.
- [ ] Screenshots are 1280×800, named `01-` through `05-`, dropped in `store/screenshots/`.
- [ ] `npm run test:unit` is green on the commit being shipped.
```

