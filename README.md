# BlurrySite

A Chrome and Firefox MV3 extension that blurs anything on a page — text,
images, videos, form fields, full sections — so what's on your screen
stays yours during screen-shares, presentations, and over-the-shoulder
moments.

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/unit_tests-906_passing-brightgreen)](#testing)
[![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow)](#how-it-works)

> **Status:** preparing for a public open-source release. Web Store
> listing in progress. Built incrementally with [Claude](https://claude.ai)
> as a thinking-and-typing partner — see [Acknowledgments](#acknowledgments).

---

## Why

Screen-shares leak. Bank tabs, chat windows, draft emails, dashboards
with internal numbers — every meeting carries the risk that one
window-switch reveals something you didn't intend to share. BlurrySite
gives you a fast, predictable way to hide arbitrary parts of a page,
on any site, with a couple of keystrokes.

The whole thing runs locally in your browser. There is **no server,
no telemetry, no analytics, no remote configuration, no update channel
beyond the browser's own**. See [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
for the line-item disclosure and [`SECURITY.md`](SECURITY.md) for the
disclosure channel.

---

## Features

### Blurring modes

- **Blur all** — one shortcut blurs every element matching your
  category mix (text / media / form / table / structure). Choose
  between standard CSS blur, frosted glass, redacted bars, or
  censored-disc font.
- **Pick & blur** — point-and-click blur for individual elements;
  also supports **sticky zones** (draw a rectangle that stays put
  even after the page reflows or you scroll).
- **Auto-detect PII** — opt-in regex pipeline that finds emails,
  phone numbers, card numbers, and other PII patterns in page text,
  with a tier-based false-positive suppressor cascade tuned to keep
  prices, version numbers, and dates from being mistaken for PII.
- **Selection blur** — select text, hit a shortcut, blur just that
  range.

### Triggers

- **Manual toggle** via popup, keyboard, or right-click menu.
- **Idle automate** — blur the whole page if you walk away.
- **Tab-switch automate** — blur when the tab loses focus.
- **Screen-share automate** — when you start sharing your screen,
  every other tab blurs automatically until the share ends.
- **Site rules** — pin a full snapshot of settings to a hostname
  (wildcard or regex). Applies forever for that site, until you
  remove the rule.

### Reveal + capture

- **Reveal mode** — hold mouse over a blurred element to peek
  (configurable: hover / click / disabled).
- **Screenshot tool** — capture a screenshot with the blur preserved
  (the blur is real CSS rendering, not a UI overlay).
- **Tab privacy** — replace the tab title with `…` so the title bar
  doesn't leak the page name during a share.

### Customisation

- **5 blur categories** with per-category opt-in.
- **Configurable shortcuts** — every action is rebindable; supports
  multi-modifier chords (Cmd / Ctrl / Alt / Shift + key).
- **Multi-language UI** — strings live in `_locales/<lang>/` and the
  popup picks one based on `chrome.i18n`.
- **Dark / light theme** for the popup.

---

## Install

### From a release build

Once published, BlurrySite will be available on:

- **Chrome Web Store:** _(pending)_
- **Firefox Add-ons:** _(pending)_

### From source (developer install)

#### Chrome / Edge / Brave

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from the project folder.

The extension runs out of the box — there is no build step required.

---

## Quick start

Once installed:

| Action | Default shortcut |
|---|---|
| Toggle blur-all on the current page | `Alt+Shift+B` |
| Open the picker | `Alt+Shift+P` |
| Clear all blur on the page | `Alt+Shift+U` |
| Open the settings panel | `Alt+Shift+O` |
| Exit picker mode | `Escape` |

Every shortcut is rebindable in the popup → "Shortcuts". Browser-level
chord conflicts can be resolved at `chrome://extensions/shortcuts`.

---

## How it works

BlurrySite is **vanilla JavaScript** — no bundler, no transpiler, no
TypeScript. Every source file under `src/` is an IIFE that assigns a
single `window.BlurrySite*` global. The browser loads them in a
fixed order from `manifest.json` and the orchestration logic in
`content_script.js` wires everything up.

```
src/
├── constants.js               message types + DEFAULT_MODEL
├── logger.js                  flow-tagged logger, runtime toggle
├── action_registry.js         single source of truth for shortcut actions
├── shortcut_label.js          platform-aware key glyphs (⌘ vs Ctrl)
├── url_matcher.js             wildcard + regex URL pattern engine
├── selector_utils.js          structural→semantic CSS-selector generator
├── storage_model.js           single chrome.storage namespace; resolve()
├── tab_privacy.js             title masking
├── pii/                       8-stage PII detection pipeline
│   ├── pii_state.js           shared private state
│   ├── pii_pre_filter.js      whole-node drop heuristics
│   ├── pii_suppressors.js     tier-based false-positive cascade
│   ├── pii_detectors.js       regex catalog + match finder
│   ├── pii_checksums.js       Luhn / Verhoeff / mod-N (phase 3)
│   ├── pii_country.js         country signal (phase 4)
│   └── pii.js                 facade: scan / clear / handleMutations
├── fonts.js                   bundled OFL fonts (disc, asterisk)
├── core/                      blur engine split by responsibility
│   ├── engine_state.js        shared private state
│   ├── categories.js          5 categories + element lists
│   ├── css_manager.js         3 CSS injection systems (blur-all / pick / pii)
│   ├── marker_engine.js       per-element stamping + match queries
│   ├── observer.js            one MO per root + idle drain + pub/sub
│   └── target_engine.js       pick-blur zones + dynamic items
├── engine.js                  facade + orchestrator (handleSite)
├── automate/                  idle / tab-switch / overlay
├── reveal_controller.js       hover-/click-to-peek
├── shortcut_handler.js        chord detection
├── selection_blur.js          text-selection driven blur
├── screenshot.js              viewport capture (blur preserved)
├── picker.js                  point-and-click + sticky zones
├── screen_share.js            getDisplayMedia bridge + port
├── main_world_bridge.js       MAIN-world hook (getDisplayMedia, attachShadow)
└── content_script.js          orchestrator (wires the rest)
```

The orchestration entry point is `blsi.Engine.handleSite(resolved)` —
it takes a fully resolved settings snapshot from `blsi.Model.resolve()`
and reconciles the DOM in one pass. There is no per-feature observer;
a single `MutationObserver` per root drains on `requestIdleCallback`
and dispatches batches to subscribers (PII, etc.).

For per-module contracts, see [`docs/contracts/`](docs/contracts/) and
[`CLAUDE.md`](CLAUDE.md). The contracts describe public APIs, edge
cases, and module-specific invariants — they're the source of truth
that PRs are reviewed against.

---

## Reproducibility

Because there is **no build step**, the published extension is
identical to the tagged release commit byte-for-byte. To verify a
release:

1. Note the version on the Chrome Web Store / Firefox AMO listing
   (matches `manifest.json` `version` field).
2. Find the matching tag in this repository.
3. Compare files inside the `.crx` / `.xpi` against the repository
   tree. Files like `manifest.json`, every file in `src/`, `popup/`,
   `styles/`, `icons/`, `fonts/`, and `_locales/` should match
   exactly. There is no minification, no transpilation, no source
   maps to chase.

If the bytes don't match, that's a bug — please report via the
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
npm run test:unit       # 906 unit tests across 24 suites — fast, jsdom
npm test                # unit + coverage report
npm run lint            # ESLint over src/ + tests/
npm run i18n:lint       # locale-coverage and key-shape lint
```

End-to-end tests under `tests/e2e/` and performance fixtures under
`tests/perf/` exist but are independently maintained — see
[`CONTRIBUTING.md`](CONTRIBUTING.md) for status.

### Project conventions

| Rule | Source |
|---|---|
| Vanilla JS only — no ES modules, no bundler. Every `src/*.js` is an IIFE assigning `blsi.Xxx`. | [`CLAUDE.md`](CLAUDE.md) |
| Read the per-module contract under `docs/contracts/` before changing any module. A pre-edit hook will remind you. | [`.claude/rules/code-contracts.md`](.claude/rules/code-contracts.md) |
| Settings are snake_case end-to-end. Stored under one `blsi_model` key, accessed via `blsi.Model`. | [`CLAUDE.md`](CLAUDE.md) |
| Conventional Commits (`feat:`, `fix:`, `chore:`, `perf:`, `refactor:`, `docs:`, `test:`). | repo history |
| `Co-Authored-By: Claude` trailer is the project convention — see Acknowledgments. | repo history |

For a fuller contributor brief, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Documentation

| Topic | Where |
|---|---|
| Per-module contracts | [`docs/contracts/`](docs/contracts/) |
| Project architecture rules | [`CLAUDE.md`](CLAUDE.md) |
| Privacy promises + storage-key inventory | [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) |
| Vulnerability reporting | [`SECURITY.md`](SECURITY.md) |
| Third-party assets + licenses | [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) |
| Browser compatibility quirks | [`docs/browser-compatibility.md`](docs/browser-compatibility.md) |

---

## Known limitations

A short list — full table including root causes lives in
[`CLAUDE.md`](CLAUDE.md) under "Known Limitations":

- **Cross-origin iframes** — picker can't reach inside; same-origin
  iframes work via `all_frames: true`.
- **Closed shadow DOM** — picker can't enter; reveal does work via
  `event.composedPath()`.
- **Chrome-restricted URLs** — `chrome://`, the extension store,
  devtools, and similar pages are blocked at the platform level. The
  popup shows a dedicated empty state on those tabs.
- **Compositing memory at scale** — every `filter: blur()` element
  becomes its own GPU compositing layer. Pages with thousands of
  blur targets may use significant renderer memory.
- **PII auto-detect over `<canvas>`** — text rendered to canvas has
  no DOM nodes to walk; `media` blur on the canvas element is the
  workaround.

---

## Acknowledgments

BlurrySite was built incrementally as a vibe-coded project — the
design + iteration happened in conversation with
[Claude](https://claude.ai) (Anthropic). Every commit carries a
`Co-Authored-By: Claude …` trailer. The licensing, architecture,
and any human-judgment calls are the author's; the keyboard time
was shared.

Third-party assets:

- **`text-security` font** — Oskari Noppa, OFL-1.1.
- **Pinyon Script font** — Nicole Fally / Google Fonts, OFL-1.1.

See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) for the full
inventory.

---

## License

[GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`).

Copyright (C) 2025 Chennakeshava G.

BlurrySite is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. It is distributed in the hope
that it will be useful, but **without any warranty**; without even
the implied warranty of merchantability or fitness for a particular
purpose. See the [`LICENSE`](LICENSE) file for the full text.
