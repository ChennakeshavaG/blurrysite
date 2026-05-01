# BlurrySite

A browser extension for Chrome and Firefox that blurs sensitive content on any
webpage — text, images, videos, form fields. Designed for screen-sharing,
presentations, and over-the-shoulder privacy.

---

## Features

- **Blur all** — one shortcut blurs all content on the page, organized into 5
  togglable categories (text, media, forms, tables, structure)
- **Element picker** — hover to highlight, click to blur/unblur individual elements
- **URL rules** — configure per-site settings with wildcard or regex URL patterns
- **Thorough blur** — optional mode that blurs all containers, even those without
  direct text content (catches framework-rendered pages)
- **Reveal modes** — hover-to-peek (default) or click-to-peek with Escape to dismiss
- **Configurable shortcuts** — primary modifier + any key combination, per action
- **Persistent blur** — blurred elements saved per hostname, restored on every visit
- **Video support** — canvas overlay approach works on DRM-protected players
- **Context menu** — right-click "Blur this element" / "Unblur this element"
- **No external requests** — all data stays in `chrome.storage.local`

---

## Keyboard Shortcuts

| Action | Default Shortcut |
|--------|-----------------|
| Blur / unblur all content | `Alt+Shift+B` |
| Open element picker | `Alt+Shift+P` |
| Clear all blur on page | `Alt+Shift+U` |
| Exit picker mode | `Escape` |

All shortcuts are customizable in the popup (hold a primary modifier, then press
additional keys). Browser-level shortcuts can be remapped at
`chrome://extensions/shortcuts`.

---

## Blur Categories

| Category | Default | What it blurs |
|----------|---------|--------------|
| Text | ON | Headings, paragraphs, links, inline semantic tags (64 element types) |
| Media | ON | Images, video, canvas |
| Form | OFF | Inputs, textareas, selects, buttons |
| Table | ON | Table cells, captions |
| Structure | ON | Divs, sections, articles, containers |

Categories are toggled in the popup under "Blur Categories". The Form category is
off by default because CSS blur on interactive fields degrades usability.

---

## URL Rules

Per-URL settings overrides. First matching rule wins.

- **Wildcard**: `*.bank.com/*` matches all banking site pages
- **Regex**: `https://portal\.health\..*` for medical portals

Each rule can override blur radius, form category, and thorough blur settings.
Managed in the popup under "URL Rules".

---

## Installation

### Chrome / Edge

1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json`

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Blur radius | 8px | Blur intensity (2-20px) |
| Reveal mode | Hover | How to peek at blurred content (hover/click/disabled) |
| Thorough blur | OFF | Blur all matched elements even without direct text |
| Smooth transition | ON | Animate blur on/off |
| Highlight colour | #f59e0b | Picker hover outline colour |

---

## Development

### Requirements

Node.js 18+, npm 9+

### Setup

```bash
npm install
```

### Tests

```bash
npm run test:unit     # 215 unit tests (fast, jsdom)
npm test              # unit + coverage report
npm run test:e2e      # 4 Puppeteer e2e tests (requires Chrome)
SKIP_E2E=1 npm test   # skip e2e in CI
```

### Project Structure

```
blurrysite/
├── manifest.json           MV3 extension manifest
├── background.js           Service worker: storage, commands, context menu
├── src/
│   ├── constants.js        Message types, DEFAULT_SETTINGS, deepMerge
│   ├── blur_engine.js      DOM blur/unblur, canvas overlay, category selectors
│   ├── content_script.js   Page orchestrator, settings resolution, URL rules
│   ├── shortcut_handler.js Multi-key simultaneous shortcut detection
│   ├── picker.js           Interactive element picker UI
│   ├── selector_utils.js   Stable CSS selector generation
│   └── storage_manager.js  Storage abstraction (messages to background)
├── styles/content.css      Injected page stylesheet (pb-* prefixed)
├── popup/                  Toolbar popup UI (settings, categories, rules, shortcuts)
├── tests/
│   ├── unit/               215 unit tests (6 test files)
│   └── e2e/                4 Puppeteer e2e tests
└── docs/
    ├── BLUR_CATEGORIES.md  Category taxonomy (64 elements across 5 categories)
    ├── DEV_GUIDE.md        Developer debugging guide
    ├── HLD.md              High-level architecture
    ├── LLD.md              Module contracts
    └── CROSS_BROWSER.md    Chrome/Firefox compatibility
```

---

## Architecture

```
Popup / Shortcut / Context Menu
         │
    background.js (service worker)
         │  chrome.storage.local (settings, rules, selectors)
         │  chrome.tabs.sendMessage
         ▼
    content_script.js (injected per page)
     ├── resolveSettings()       URL rule resolution
     ├── PrivacyBlurEngine       category-based blur/unblur
     ├── PrivacyBlurShortcuts    multi-key shortcut detection
     ├── PrivacyBlurPicker       hover-highlight + click-to-blur
     ├── PrivacyBlurStorage      async storage API
     └── PrivacyBlurSelectorUtils CSS selector generation
```

See [`docs/HLD.md`](docs/HLD.md) and [`docs/LLD.md`](docs/LLD.md) for details.

---

## Known Limitations

- **DRM video** — canvas cannot read encrypted frames; shows dark mask instead
- **Cross-origin iframes** — content scripts cannot reach inside
- **Closed shadow DOM** — not accessible via CSS selectors
- **`<select>` dropdowns** — CSS blur only covers closed state; open dropdown is visible
- **`position: sticky`** — sticky elements inside blurred containers stop sticking (same root cause as fixed positioning)
- **SVG diagrams** — SVGs excluded globally to preserve icons; blur manually via picker
- **`filter: blur()` at large fonts** — 8px radius partially readable at 20px+ font

---

## Privacy

All data stored locally in `chrome.storage.local`. No analytics, no external
servers, no telemetry.

---

## License

[GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`).

Copyright (C) 2025 Chennakeshava G.

BlurrySite is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your
option) any later version. It is distributed in the hope that it will be
useful, but **without any warranty**; without even the implied warranty
of merchantability or fitness for a particular purpose. See the
[`LICENSE`](LICENSE) file for the full text.

Third-party assets (fonts, icons) carry their own licenses — see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) for the inventory.
