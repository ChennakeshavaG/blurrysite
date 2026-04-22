# BlurrySite Icons

## Design

**Concept:** Frosted glass disc on a solid square background. Amber (#f59e0b) cursive "blur" text easter egg visible through the frost — Pinyon Script (1600s copperplate style).

**Text alignment:** `text-anchor="middle"` + `dominant-baseline="central"` at `x="256" y="256"` — em-box center = circle center.

**Frosted effect:** SVG-only. `feTurbulence` grain on the disc + `feGaussianBlur` soft glow on the text. No CSS backdrop-filter (caused double-ring artifacts).

---

## Files

| File | Description |
|---|---|
| `logo-dark.svg` | Master SVG — dark background (`#0d0d0d`), white frost disc |
| `logo-light.svg` | Master SVG — light background (`#f5f5f5`), dark frost disc |
| `logo-dark.png` | 512×512 raster of dark master (Chrome Web Store) |
| `logo-light.png` | 512×512 raster of light master |
| `icon128.png` | 128×128 dark |
| `icon128-light.png` | 128×128 light |
| `icon48.png` | 48×48 dark |
| `icon48-light.png` | 48×48 light |
| `icon32.png` | 32×32 dark |
| `icon32-light.png` | 32×32 light |
| `icon16.png` | 16×16 dark |
| `icon16-light.png` | 16×16 light |
| `index.html` | Visual showcase — all sizes, dark + light, SVG masters, toolbar chip sim |

---

## manifest.json wiring

```json
"action": {
  "default_icon": { "16": "icons/icon16.png", "32": "icons/icon32.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
},
"icons": {
  "16": "icons/icon16.png", "32": "icons/icon32.png",
  "48": "icons/icon48.png", "128": "icons/icon128.png",
  "512": "icons/logo-dark.png"
}
```

Light variants (`*-light.png`) are not referenced in manifest — they are reserved for future themed toolbar support or store screenshots.

---

## Re-rendering PNGs

PNGs must be rendered via inline SVG + Playwright screenshot (not canvas `drawImage` — that strips the embedded Pinyon Script font).

1. Start a local HTTP server in `icons/`: `python3 -m http.server 9181`
2. Navigate Playwright to `http://localhost:9181/index.html` (or `render-direct.html?src=logo-dark.svg&size=512`)
3. Resize viewport to exact pixel size, take screenshot

---

## SVG internals

```
512×512 viewBox
├── <defs>
│   ├── @font-face — Pinyon Script WOFF2 base64 embedded
│   ├── #frosted-surface filter — feTurbulence grain → feBlend soft-light → feComposite in → feGaussianBlur
│   └── #text-blur filter — feGaussianBlur stdDeviation="7"
├── <rect> — solid background (full canvas)
├── <circle cx="256" cy="256" r="200"> — frosted disc
└── <text x="256" y="256" dominant-baseline="central"> — "blur" in Pinyon Script
```

Dark disc: `fill="rgba(255,255,255,0.38)"`  
Light disc: `fill="rgba(0,0,0,0.14)"`
