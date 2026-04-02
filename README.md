# PrivacyBlur

A browser extension for Chrome and Firefox that lets you blur sensitive text, images, and videos on any webpage — instantly, with a keyboard shortcut or by clicking individual elements.

---

## Features

- **Chord shortcut** — `Ctrl+K` → `V` (within 1 second) blurs/unblurs all page content
- **Manifest shortcuts** — `Alt+Shift+B` (blur all), `Alt+Shift+P` (picker), `Alt+Shift+U` (clear)
- **Element picker** — hover any element to highlight it, click to blur or unblur it individually
- **Persistent blur** — blurred elements are saved per hostname and restored on every page visit
- **Video support** — canvas overlay approach works on DRM-protected video players
- **Reveal on hover** — optional setting that temporarily unblurs elements under the cursor
- **Right-click menu** — "Blur this element" and "Unblur this element" context menu entries
- **No external requests** — all state is stored locally; no data ever leaves your browser

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Blur / unblur all content | `Alt+Shift+B` |
| Open element picker | `Alt+Shift+P` |
| Clear all blur on page | `Alt+Shift+U` |
| Chord — blur all (configurable) | `Ctrl+K` then `V` within 1 second |
| Exit picker mode | `Escape` |

> The chord keys and modifier are configurable in the popup settings panel.
> The `Alt+Shift+*` shortcuts can be remapped at `chrome://extensions/shortcuts`.

---

## How Blur Works

| Element type | Technique |
|---|---|
| Generic element / text | CSS `filter: blur()` via `.pb-blurred` class and CSS custom property `--pb-radius` |
| `<img>` | CSS `filter: blur()` applied directly on the element |
| `<video>` | `<canvas>` overlay drawn per frame via `requestAnimationFrame`; bypasses DRM restrictions |
| Background images | CSS `filter: blur()` on the element |

---

## Installation

### Chrome / Edge

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `privacyblur/` folder.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `privacyblur/manifest.json`.

> For a permanent Firefox install the extension must be signed via [AMO](https://addons.mozilla.org/developers/).  
> For local development only, set `xpinstall.signatures.required` to `false` in `about:config`.

---

## Usage

### Blur everything on the page

Press `Alt+Shift+B` or the chord `Ctrl+K` → `V`. Press again to remove all blur.

### Use the element picker

1. Press `Alt+Shift+P` (or click the toolbar icon → "Pick elements").
2. Hover an element — an amber outline appears.
3. Click to blur. Click again to unblur.
4. Press `Escape` to exit.

### Persistent blur

When you blur an element via the picker, its CSS selector is saved for the hostname. On every subsequent visit PrivacyBlur automatically re-applies blur — no re-selection needed.

### Clearing blur

- **Current page**: `Alt+Shift+U` or "Clear page" button in the popup.
- **All sites**: popup → "Clear all data".

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Blur radius | `8px` | Blur intensity in pixels |
| Smooth transition | `on` | Animate blur on/off |
| Reveal on hover | `off` | Temporarily unblur on mouse-over |
| Highlight colour | `#f59e0b` | Picker hover outline colour |
| Chord key 1 | `k` | First key (with modifier) |
| Chord key 2 | `v` | Second key (plain, within 1 second) |
| Chord modifier | `ctrl` | Modifier: `ctrl`, `alt`, `shift`, or `meta` |

---

## Development

### Requirements

- Node.js 18+, npm 9+

### Setup

```bash
cd privacyblur
npm install
```

### Tests

```bash
npm run test:unit     # unit tests only (fast, jsdom, no browser)
npm test              # all tests + coverage report
npm run test:watch    # watch mode
npm run test:e2e      # Puppeteer end-to-end (requires Chrome)
SKIP_E2E=1 npm test   # skip e2e in CI
```

Coverage thresholds: **70% lines**, **70% functions** across `src/`.

### Lint

```bash
npm run lint
```

### Project structure

```
privacyblur/
├── manifest.json           MV3 extension manifest (Chrome + Firefox)
├── background.js           Service worker: storage, commands, context menu
├── src/
│   ├── blur_engine.js      DOM blur/unblur, canvas overlay for video
│   ├── content_script.js   Page orchestrator: wires all modules
│   ├── picker.js           Interactive element picker UI
│   ├── selector_utils.js   Stable CSS selector generation
│   ├── shortcut_handler.js Keyboard chord detection
│   └── storage_manager.js  Storage abstraction (messages to background)
├── styles/content.css      Injected page stylesheet (all pb- prefixed)
├── popup/                  Toolbar popup UI
├── icons/                  Extension icons: 16, 32, 48, 128 px
├── tests/
│   ├── setup.js            Jest setup: chrome.* mocks, canvas stub, rAF stub
│   ├── unit/               104 Jest + jsdom unit tests
│   └── e2e/                Puppeteer e2e tests
└── docs/
    ├── HLD.md              High-level architecture
    ├── LLD.md              Low-level design and module contracts
    └── CROSS_BROWSER.md    Chrome / Firefox compatibility guide
```

---

## Architecture Summary

```
Browser Action / Shortcut / Context Menu
          │
     background.js (service worker)
          │  chrome.storage.local
          │  chrome.tabs.sendMessage
          ▼
     content_script.js  (injected per page)
      ├── PrivacyBlurEngine      blur/unblur DOM
      ├── PrivacyBlurStorage     save/load selectors via background
      ├── PrivacyBlurSelectorUtils  stable CSS selector generation
      ├── PrivacyBlurShortcuts   chord + Escape keyboard handling
      └── PrivacyBlurPicker      hover-highlight + click-to-blur UI
```

See [`docs/HLD.md`](docs/HLD.md) and [`docs/LLD.md`](docs/LLD.md) for full design documentation.

---

## Known Limitations

- **DRM video** — canvas cannot read DRM-encrypted frames (Netflix, Disney+). The canvas overlay shows a solid dark mask instead of a blurred frame.
- **Cross-origin iframes** — content scripts cannot reach inside cross-origin iframes.
- **Shadow DOM** — closed shadow roots are not accessible via CSS selectors.
- **SPA navigation** — route changes that re-render the DOM may invalidate stored selectors. Re-apply via the picker after navigation.
- **`position: fixed` children** — CSS `filter` creates a new stacking context; `fixed` descendants of a blurred container will move with the container. Target children individually to avoid this.

---

## Privacy

PrivacyBlur stores blur state only in `chrome.storage.local` on your device. No analytics, no external servers, no telemetry of any kind.

---

## Contributing

1. Fork the repository and create a branch from `main`.
2. Follow the existing code style — vanilla JS, no bundler, no ES modules.
3. Add tests for any behaviour change. Coverage must stay ≥ 70%.
4. Run `npm test` and `npm run lint` before opening a PR.
5. All features must work in Chrome (MV3) and Firefox 109+.

---

## License

MIT
