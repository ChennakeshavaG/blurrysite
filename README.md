# BlurrySite

A Chrome (released) and Firefox (in testing) MV3 extension that blurs anything on a page: 
text, images, videos, form fields, full sections
so what's on your screen stays yours during screen shares, presentations, and over the shoulder moments.

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow)](#how-it-works)

> Built incrementally with [Claude](https://claude.ai)
> as a thinking-and-typing partner — see [Acknowledgments](#acknowledgments).

[GitHub](https://github.com/ChennakeshavaG/blurrysite) · [Feedback / Rate on Chrome Web Store](https://chromewebstore.google.com/detail/nceghmchnpfippfofmbagckbinnkgaje)

---

## Why

Screen shares leak. Bank tabs, chat windows, draft emails, dashboards
with internal numbers every meeting carries the risk that one
window switch reveals something you didn't intend to share. I built
BlurrySite to give you a fast, predictable way to hide arbitrary
parts of a page, on any site, with a couple of keystrokes.

The whole thing runs locally in your browser. There is **no server,
no telemetry, no analytics, no remote configuration, no update
channel beyond the browser's own**. See
[`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) for the line item disclosure
and [`SECURITY.md`](SECURITY.md) for the disclosure channel.

---

## Features

### Stay Blurry

- **Screen share protection** — when you start sharing your screen,
  every other tab blurs automatically until the share ends. Per tab
  and per site suppression if you need to exempt something mid share.
- **Sensitive info auto-detect** — opt in regex pipeline that finds
  emails, phone numbers, card numbers, and other PII patterns in page
  text. Tier based false positive suppressor keeps prices, version
  numbers, and dates from being mistaken for PII. Choose blur,
  frosted, redacted, or starred rendering.
- **Tab privacy** — replace the tab title with `…` so the title bar
  doesn't leak the page name during a share.

### How to Blur

- **Blur all** — one shortcut blurs every element matching your
  category mix (text / media / form / table / structure). Four blur
  modes: standard CSS blur, frosted glass, redacted bars, or
  censored disc font in customise section.
- **Pick & blur** — pick and click blur for individual elements.
  Three picker modes: **dynamic** (selector based, follows the
  element), **sticky page** (rectangle anchored to document), and
  **sticky screen** (rectangle fixed to viewport, ideal for
  streaming). Supports blur, frosted, and solid color types.

### Smart Triggers

- **Tab switch** — blur the page when it loses focus.
- **Idle timer** — blur after a configurable period of inactivity
  (15 seconds to 60 minutes). Uses the system idle API, not DOM
  timers.

### General

- **Blur strength** — adjustable radius slider.
- **Reveal mode** — hover, click, or disabled. Peek through blur
  without removing it.
- **Transition duration** — instant or smooth
- **Screenshot** — capture a viewport screenshot with blur preserved
  (real CSS rendering, not a UI overlay).
- **Selection blur** — select text, hit a shortcut, blur just that
  range.
- **Multi language UI** — strings in `_locales/<lang>/`, picked via
  `chrome.i18n`.
- **Dark / light theme** for the popup.
- **Export / import** — full settings backup as JSON.

### Shortcuts

- **5 rebindable actions** — toggle blur all, toggle picker, clear
  all blur, screenshot, and selection blur. Supports multi modifier
  chords (Cmd / Ctrl / Alt / Shift + key).

### Site Rules

- **Per hostname snapshots** — pin a full settings snapshot to a
  hostname (exact, wildcard, or regex). Applies automatically on
  every visit until you remove the rule. Popup shows a "managed by
  site rule" banner when a rule is active.

---

## Install

### From a release build

BlurrySite is available on:

- **Chrome Web Store:** [BlurrySite](https://chromewebstore.google.com/detail/nceghmchnpfippfofmbagckbinnkgaje)
- **Firefox Addons:** _(pending)_

### From source (developer install)

#### Chrome / Edge / Brave

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the project folder.

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Addon**.
3. Select `manifest.json` from the project folder.

The extension runs out of the box, there is no build step required.

---

## Quick start

Once installed:

| Action | Default shortcut |
|---|---|
| Toggle blur all on the current page | `Alt+Shift+B` |
| Open the picker | `Alt+Shift+P` |
| Clear all blur on the page | `Alt+Shift+U` |
| Open the settings panel | `Alt+Shift+O` |
| Exit picker mode | `Escape` |

Every shortcut is rebindable in the popup → "Shortcuts". Browser level
chord conflicts can be resolved at `chrome://extensions/shortcuts`.

---

## How it works

I wrote BlurrySite in **vanilla JavaScript** -> no bundler, no
transpiler, no TypeScript. Every source file under `src/` is an IIFE
that assigns a single `window.BlurrySite*` global. The browser loads
them in a fixed order declared in `manifest.json`, and
`content_script.js` wires everything together at page load.

All settings live under a single `chrome.storage.local` key
(`blsi_model`), accessed through `blsi.Model`. When any setting
changes, `chrome.storage.onChanged` fires, the content script
resolves the new state, and each subsystem rerenders in one pass.

### Stay Blurry

**Screen share protection** hooks
`navigator.mediaDevices.getDisplayMedia` in the page's MAIN world
via a small bridge script injected at `document_start`. When a share
starts, the bridge posts a message to the content script, which
relays it to the background service worker. Active streams are
tracked per tab in `chrome.storage.session`, and a notification is
broadcast to every other tab. Non sharing tabs read the session state
and show a full viewport frosted overlay until the share ends. Each
stream is tracked independently, so multiple concurrent shares from
different tabs work correctly.

**Sensitive info auto detect** is a multi stage PII pipeline that
runs in idle chunks (500 text nodes per tick) to avoid blocking the
page. Stage 1 applies regex detectors for emails, phone numbers,
card numbers, and financial patterns. Stage 2 runs dispositive
validators (Luhn for credit cards, mod-97 for IBANs, Verhoeff for
Aadhaar). Stage 3 applies a false positive suppressor cascade that
filters out dates, version numbers, prices, measurements, and other
number like patterns. Matches are wrapped in `<span>` elements with
a `data-bl-si-pii` attribute and blurred via CSS independently of
blur all. A MutationObserver subscription rescans new content as
the page changes.

**Tab privacy** intercepts `document.title` writes via a property
descriptor override and replaces the title with a generic string.
Favicon `<link>` elements are swapped with a blank 1×1 PNG data URI,
preventing tabbar text like unread counts or page names from leaking
during a share.

### How to Blur

**Blur all** works by injecting three independent `<style>` blocks
into the document head (and into each observed shadow root): one for
blur all, one for pick & blur, and one for PII. The blur all stylesheet
targets elements by tag name across five categories (text, media,
form, table, structure) and applies a CSS `filter: blur()` with a
configurable radius. Each matched element is stamped with a
`data-bl-si-blur` attribute so the reveal system can find it. Four
rendering modes are available: standard Gaussian blur, a frosted
glass effect (SVG `feTurbulence` filter), solid colour redacted bars,
and a censored disc font substitution.

A single `MutationObserver` per document root (including shadow
roots) watches for new elements and text changes. Mutations are
buffered and drained on `requestIdleCallback` to avoid long task
violations. The drain stamps new elements that match active
categories and dispatches text change records to PII subscribers.

**Pick & blur** lets you target individual elements or draw
rectangles. In dynamic mode, clicking an element generates a stable
CSS selector (structural path with semantic fallbacks like class,
aria, or data attributes) and stores it per hostname. On page load,
stored selectors are requeried and matched elements receive a
`data-bl-si-pick-blur` stamp. In sticky page mode, you drag a
rectangle anchored to document coordinates, it scrolls with the
page. In sticky screen mode, the rectangle is viewport fixed
(`position: fixed`) and stays in place during scroll, which is useful
for streaming. Up to 10 pick & blur items are stored per hostname.

### Smart Triggers

**Tab switch** uses `document.visibilitychange` and `window.blur` /
`window.focus` events to detect when a tab loses focus. When the tab
becomes hidden or unfocused, a `'fired'` state is written to
`chrome.storage.session` for that tab ID. The automate manager reads
this state and shows the full viewport frosted overlay. The overlay
dismisses automatically when the tab regains focus.

**Idle timer** runs in the background service worker using
`chrome.idle.onStateChanged`, which monitors system level inactivity
(not DOM events). You configure a threshold between 15 seconds and
60 minutes. When the system transitions to `'idle'` or `'locked'`,
the background writes the phase to session storage. Every content
script reads the change and the manager shows the overlay. The
overlay clears when the system returns to `'active'`.

Both triggers operate independently of manual blur,the overlay
layers on top of whatever blur state already exists and does not
modify `blur_all.status`.

### General

**Reveal** attaches capture phase `mouseover` and `click` listeners
(depending on the configured mode) to the document. When triggered,
it walks up the DOM, including through shadow root boundaries via
`composedPath()` — to find the nearest blurred ancestor, then stamps
it and all blurred descendants with `data-bl-si-reveal`. A CSS rule
`[data-bl-si-reveal] { filter: none !important }` clears the blur
temporarily. The reveal dismisses on mouseout (with a 50 ms debounce)
or on Escape.

**Screenshot** sends a message to the background service worker,
which calls `chrome.tabs.captureVisibleTab()` to grab the current
viewport as a PNG. Because the blur is real CSS rendering (not a UI
overlay), it gets captured in the image. The content script receives
the data URL and offers download or copy-to-clipboard.

**Selection blur** reads `document.getSelection()`, walks the
selected text ranges with a `TreeWalker`, and wraps matched text
nodes in `<span data-bl-si-selection>` elements that receive blur
CSS. The wrapping is done right-to-left to preserve text offsets.
The blur persists until page reload.

### Shortcuts

Every action (toggle blur all, toggle picker, clear all, screenshot,
selection blur) is registered in `action_registry.js` with a default
key binding. `shortcut_handler.js` listens for `keydown` at capture
phase, matches `event.code` plus sorted modifier flags against the
registered bindings, and dispatches the first match back to the
content script. All bindings are rebindable, the popup's Shortcuts
page captures a new chord and persists it to `model.shortcuts`.

### Site Rules

Site rules are stored in `model.site_rules` as an array of
`{ hostname_value, hostname_type, snapshot }` entries.
`hostname_type` can be `'exact'`, `'wildcard'`, or `'regex'`, matched
via `url_matcher.js`. When `blsi.Model.resolve()` runs for a page, it
checks the current hostname against every rule. If a rule matches,
its snapshot is deep merged over the global defaults, and the resolved
settings carry `_rule_overrides` so the popup can show a "managed by
site rule" banner and lock the overridden controls. Display knobs
like blur radius and reveal mode are never captured in snapshots,
they remain globally editable.

For per module contracts, see [`docs/contracts/`](docs/contracts/) and
[`CLAUDE.md`](CLAUDE.md).

---

## Reproducibility

Because there is **no build step**, the published extension is
identical to the tagged release commit byte for byte. To verify a
release:

1. Note the version on the Chrome Web Store / Firefox AMO listing
   (matches `manifest.json` `version` field).
2. Find the matching tag in this repository.
3. Compare files inside the `.crx` / `.xpi` against the repository
   tree. Files like `manifest.json`, every file in `src/`, `popup/`,
   `styles/`, `icons/`, `fonts/`, and `_locales/` should match
   exactly. There is no minification, no transpilation, no source
   maps to chase.

If the bytes don't match, that's a bug, please report it via the
channel in [`SECURITY.md`](SECURITY.md).

---

## Development

### Requirements

- Node.js 18+
- npm 9+

### Setup

```bash
npm install
```

The `package-lock.json` pins all dependencies against the public
npm registry (`https://registry.npmjs.org/`).

### Testing

```bash
npm run test:unit       # 1205 unit tests across 29 suites — fast, jsdom
npm test                # unit + coverage report
npm run lint            # ESLint over src/ + tests/
npm run i18n:lint       # locale-coverage and key-shape lint
```

End to end tests under `tests/e2e/` and performance fixtures under
`tests/perf/` exist but are independently maintained, see
[`CONTRIBUTING.md`](CONTRIBUTING.md) for status.

### Project conventions

| Rule | Source |
|---|---|
| Vanilla JS only; no ES modules, no bundler. Every `src/*.js` is an IIFE assigning `blsi.Xxx`. | [`CLAUDE.md`](CLAUDE.md) |
| Read the per-module contract under `docs/contracts/` before changing any module. A pre edit hook will remind you. | [`.claude/rules/code-contracts.md`](.claude/rules/code-contracts.md) |
| Settings are snake_case end to end. Stored under one `blsi_model` key, accessed via `blsi.Model`. | [`CLAUDE.md`](CLAUDE.md) |
| Conventional Commits (`feat:`, `fix:`, `chore:`, `perf:`, `refactor:`, `docs:`, `test:`). | repo history |
| `Co-Authored-By: Claude` trailer is the project convention; see Acknowledgments. | repo history |

For a fuller contributor brief, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Documentation

| Topic | Where |
|---|---|
| Per-module contracts | [`docs/contracts/`](docs/contracts/) |
| Project architecture rules | [`CLAUDE.md`](CLAUDE.md) |
| Privacy promises + storage key inventory | [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) |
| Vulnerability reporting | [`SECURITY.md`](SECURITY.md) |
| Third-party assets + licenses | [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) |
| Browser compatibility quirks | [`docs/browser-compatibility.md`](docs/browser-compatibility.md) |

---

## Known limitations and what I'm improving

- **Shadow DOM on some sites** — sites like Reddit use closed shadow
  roots heavily, which the picker can't reach into yet. Blur all and
  reveal work fine, but selecting individual elements inside shadow
  DOM is a planned improvement.
- **Iframes on some sites** — cross origin iframes (embedded videos,
  third party widgets) are browser sandboxed, so pick and blur can't
  cross into them. Same origin iframes work.
- **Deeply nested layouts** — sites like WhatsApp Web use many layers
  of nested `<div>` wrappers, which can make category based blur
  over select or under select. I'm improving selector heuristics for
  these patterns.
- **Chrome-restricted pages** — browser internal pages (`chrome://`,
  the Web Store, devtools) block all extensions at the platform
  level. The popup shows a friendly empty state on those tabs.
- **Performance on heavy pages** — DOM walkthroughs currently use
  `requestIdleCallback` for batching, which works well on most pages
  but can feel sluggish on very large DOMs. I'm exploring
  alternatives like chunked scheduling and off main thread
  approaches to make blur and PII scanning faster on heavy sites.
  Research lives in three companion docs (read in order):
  - [`docs/research/scheduling-foundations.md`](docs/research/scheduling-foundations.md) —
    first principles: event loop, input pipeline, `isInputPending`
    internals, INP, `scheduler.yield()` mechanics, with timing
    callouts and ASCII diagrams.
  - [`docs/research/scheduling-deep-dive.md`](docs/research/scheduling-deep-dive.md) —
    full repo audit (every `requestIdleCallback` call site with
    file:line, deadlines, throttling exposure), per-site comparison
    against alternatives, and a 6-phase migration plan.
  - [`docs/research/scheduling-alternatives.md`](docs/research/scheduling-alternatives.md) —
    surface summary of `scheduler.postTask` / `scheduler.yield` /
    `isInputPending` / `MessageChannel` with browser support.
- **PII regex coverage** — the current detector handles common
  patterns (emails, card numbers, phone numbers) but regional
  variations and edge case formats can slip through. I'm working on
  expanding the regex catalog and improving the false positive
  suppressor cascade to handle more locale specific patterns.
- **Canvas content** — text drawn inside `<canvas>` elements has no
  DOM nodes, so PII detection can't scan it. Blurring the entire
  canvas element is the workaround for now.

---

## Acknowledgments

I built BlurrySite incrementally as a vibe coded project, the
design + iteration happened in conversation with
[Claude](https://claude.ai) (Anthropic). Every commit carries a
`Co Authored By: Claude …` trailer. The licensing, architecture,
and any human judgment calls are mine.

Third-party assets:

- **`text-security` font** — Oskari Noppa, OFL-1.1.
- **Pinyon Script font** — Nicole Fally / Google Fonts, OFL-1.1.

See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) for the full
inventory.

---

## License

[GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`).

Copyright (C) 2026 Chennakeshava G.

BlurrySite is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. It is distributed in the hope
that it will be useful, but **without any warranty**; without even
the implied warranty of merchantability or fitness for a particular
purpose. See the [`LICENSE`](LICENSE) file for the full text.
