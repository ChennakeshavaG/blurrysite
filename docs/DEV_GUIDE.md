# PrivacyBlur — Developer & Debugging Guide

## Quick Start

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this project folder
4. Pin the extension from the puzzle-piece icon in the toolbar

After any code change, click the **reload** button on the extension card at `chrome://extensions`.

---

## Entry Points

There are **three independent entry points** that run in different contexts:

### 1. Content Scripts (injected into every page)

**Files loaded in order** (defined in `manifest.json` → `content_scripts`):

```
src/constants.js         → globalThis.PrivacyBlur (message types, DEFAULTS)
src/selector_utils.js    → window.PrivacyBlurSelectorUtils
src/storage_manager.js   → window.PrivacyBlurStorage
src/blur_engine.js       → window.PrivacyBlurEngine
src/shortcut_handler.js  → window.PrivacyBlurShortcuts
src/picker.js            → window.PrivacyBlurPicker
src/content_script.js    → orchestrator (no global)
```

**`content_script.js` is the main orchestrator.** It runs `init()` on DOMContentLoaded:

```
init()
├── Bind module aliases (Engine, Store, Selector, Picker, Shortcuts)
├── Load settings from storage via Store.getSettings()
├── Apply CSS custom properties (--pb-radius, etc.)
├── Register chrome.runtime.onMessage.addListener(handleMessage)
├── If enabled:
│   ├── Shortcuts.init() — attach keyboard chord listener
│   ├── restoreBlurredElements() — re-blur saved selectors
│   ├── startDomObserver() — batched observer for dynamic content
│   └── Register hover delegation (mouseover/mouseout for ancestor reveal)
```

**`handleMessage()`** is the central dispatcher. Every action flows through it:

| Message Type | Source | What it does |
|---|---|---|
| `TOGGLE_BLUR_ALL` | background (keyboard shortcut) or popup | Blur/unblur all content using category settings |
| `TOGGLE_PICKER` | background (keyboard shortcut) | Activate/deactivate element picker |
| `CLEAR_ALL_BLUR` | popup Clear Page button | Remove all blur + clear storage |
| `RESTORE` | background (on page load complete) | Re-apply saved blur selectors |
| `UPDATE_SETTINGS` | popup (settings change) | Update local settings, invalidate selector cache |
| `CONTEXT_BLUR` | background (right-click menu) | Blur the right-clicked element |
| `CONTEXT_UNBLUR` | background (right-click menu) | Unblur the right-clicked element |
| `UNBLUR_SELECTOR` | popup (remove from list) | Unblur a specific CSS selector |
| `GET_STATUS` | popup | Return blur count and state |

### 2. Background Service Worker

**File:** `background.js`

Runs as a stateless MV3 service worker. Responsibilities:
- **Storage gateway** — all `chrome.storage.local` reads/writes go through here
- **Command relay** — `chrome.commands.onCommand` → `chrome.tabs.sendMessage`
- **Context menu** — create/handle right-click blur/unblur items
- **Tab listener** — send `RESTORE` on page load complete

### 3. Popup UI

**Files:** `popup/popup.html`, `popup/popup.js`, `popup/popup.css`

Opened when the user clicks the toolbar icon. Flow:
```
popup.js init()
├── chrome.tabs.query() — find the active http/https tab
├── bgMessage(GET_SETTINGS) — load settings from background
├── bgMessage(GET_SELECTORS) — load blur list for this hostname
├── Render UI (settings, category toggles, blur list)
└── wireControls() — attach click/change listeners to all buttons
```

Popup communicates via:
- `bgMessage()` → `chrome.runtime.sendMessage` → background.js (storage ops)
- `tabMessage()` → `chrome.tabs.sendMessage` → content_script.js (blur actions)

---

## Category-Based Blur System

The blur engine uses 5 independently togglable categories. Each category maps HTML
elements to two passes (always-blur and text-check). See `docs/BLUR_CATEGORIES.md`
for the full element taxonomy.

| Category | Default | Elements | Description |
|---|---|---|---|
| text | ON | 42 | Headings, paragraphs, inline semantic tags |
| media | ON | 3 | Images, video, canvas |
| form | OFF | 7 | Inputs, textareas, selects, buttons |
| table | ON | 3 | Table cells, captions |
| structure | ON | 9 | Divs, sections, articles, containers |

**Thorough blur** (OFF by default): when enabled, the text-check pass skips the
`hasMeaningfulTextContent` gate, blurring all matching elements unconditionally.
Catches containers with nested-only text at the cost of blurring empty layout wrappers.

**Settings path:** `constants.js DEFAULTS` → `background.js DEFAULT_SETTINGS` →
`chrome.storage.local` → `storage_manager.js getSettings()` → `content_script.js settings` →
`Engine.blurAllContent(radius, { categories, thoroughBlur })`.

---

## Reveal Modes

`settings.revealMode` controls how users peek at blurred content:

| Mode | Default | Behavior |
|---|---|---|
| `click` | YES | Click a blurred element to peek. Click again or press Escape to re-blur. WCAG compliant, touch-friendly, no hover conflicts. |
| `hover` | no | Hover to peek. JS manages ancestor chain with 150ms debounced mouseout. May conflict with site dropdowns/tooltips. |
| `none` | no | No reveal — blurred content stays blurred until manually unblurred via picker or clear. |

Both click and hover modes use the same ancestor chain mechanism: when an element
is revealed, JS walks up the DOM and adds `pb-ancestor-reveal` to blurred ancestors
so the revealed content is visible through the ancestor chain.

**CSS classes:**
- `pb-revealed` — added by click mode (JS-toggled)
- `pb-reveal-on-hover` — added by hover mode (CSS `:hover` drives it)
- `pb-ancestor-reveal` — added to blurred ancestors in both modes

**`will-change: filter` was removed** from `.pb-blurred` because it creates a
permanent stacking context that breaks `position: fixed/sticky` children and
z-index hover elevation on sites.

---

## Performance Architecture

### MutationObserver (batched)

During blur-all mode, new DOM nodes are queued and processed in RAF chunks of 50.
This prevents SPA navigation from blocking the main thread.

```
Observer callback → collect addedNodes into pendingNodes[]
                  → schedule requestAnimationFrame(processBlurChunk)

processBlurChunk → process 50 elements from queue
                 → if more remain, schedule another RAF
                 → skips disconnected nodes (node.isConnected check)
```

### Selector cache

Category selectors are pre-joined into comma-separated strings and cached with a
5-bit key derived from category toggles. Rebuilt only when `invalidateSelectorCache()`
is called (on settings change).

---

## Debugging Setup

### Step 1: Add `debugger` statements

Add `debugger;` anywhere you want to pause. Key locations:

**To debug blur triggering** — `src/content_script.js`:
```js
function handleMessage(message, _sender, sendResponse) {
    debugger; // pause on every incoming message
    const { type } = message;
```

**To debug the blur engine** — `src/blur_engine.js`:
```js
function applyBlur(element, radius = 8) {
    debugger; // pause when any element gets blurred
    if (!element || !(element instanceof Element)) return;
```

**To debug categories** — `src/blur_engine.js`:
```js
function blurAllContent(radius = 8, options) {
    debugger; // pause to inspect categories and selector cache
    const cats = (options && options.categories) ? options.categories : DEFAULT_ALL_ON;
```

**To debug the popup** — `popup/popup.js`:
```js
ui.blurAllBtn.addEventListener('click', async () => {
    debugger; // pause when Blur All is clicked
    if (!currentTab) return;
```

### Step 2: Open DevTools for each context

Each entry point has its **own DevTools**:

| Context | How to open DevTools |
|---|---|
| **Content script** | F12 on any page → Sources tab → find files under `content_scripts/` in the file tree. Or use the Console context dropdown to switch to the extension world. |
| **Background service worker** | `chrome://extensions` → find PrivacyBlur → click **"Service worker"** link |
| **Popup** | Right-click the popup → **Inspect** |

### Step 3: Set breakpoints visually

Instead of `debugger;` statements, you can set breakpoints in DevTools:

1. Open DevTools for the relevant context
2. Go to **Sources** tab
3. Find the file (e.g., `src/content_script.js`)
4. Click the line number to set a breakpoint
5. Trigger the action (click a button, press a shortcut)
6. Execution pauses — use Step Over (F10), Step Into (F11), Continue (F8)

---

## Debug Cheat Sheet

### Console commands (switch to extension context first)

```js
// Check current settings
PrivacyBlurStorage.getSettings().then(console.log)

// Check saved selectors for current page
PrivacyBlurStorage.getBlurredSelectors(location.hostname).then(console.log)

// Blur everything (all categories ON)
PrivacyBlurEngine.blurAllContent(8)

// Blur with specific categories
PrivacyBlurEngine.blurAllContent(8, {
  categories: { text: true, media: true, form: false, table: true, structure: true },
  thoroughBlur: false
})

// Unblur everything
PrivacyBlurEngine.unblurAll()

// Check if an element is blurred
PrivacyBlurEngine.isBlurred(document.querySelector('#someId'))

// Check if an element matches active categories
PrivacyBlurEngine.matchesActiveCategories(
  document.querySelector('input'),
  { text: true, media: true, form: true, table: true, structure: true }
)

// Inspect category selectors
console.table(PrivacyBlurEngine.CATEGORY_SELECTORS)

// Force selector cache rebuild
PrivacyBlurEngine.invalidateSelectorCache()

// Activate picker manually
PrivacyBlurPicker.activate(
  { blurRadius: 8, highlightColor: '#f59e0b' },
  {
    onBlur: (el) => { PrivacyBlurEngine.applyBlur(el, 8); console.log('Blurred:', el); },
    onUnblur: (el) => { PrivacyBlurEngine.removeBlur(el); console.log('Unblurred:', el); },
    onDeactivate: () => console.log('Picker deactivated')
  }
)

// Deactivate picker
PrivacyBlurPicker.deactivate()

// Count blurred elements by tag
const counts = {};
document.querySelectorAll('.pb-blurred').forEach(el => {
  const tag = el.tagName.toLowerCase();
  counts[tag] = (counts[tag] || 0) + 1;
});
console.table(counts)
```

### Background service worker console

```js
// Read all stored selectors
chrome.storage.local.get('blurred_selectors', console.log)

// Read all settings (includes blurCategories and thoroughBlur)
chrome.storage.local.get('settings', console.log)

// Clear all data
chrome.storage.local.clear()

// Send a message to the active tab
chrome.tabs.query({active: true, currentWindow: true}, ([tab]) => {
  chrome.tabs.sendMessage(tab.id, {type: 'TOGGLE_BLUR_ALL'}, console.log)
})
```

---

## Common Debug Scenarios

### "Blur All does nothing"
1. Check `settings.enabled` — is it `false`?
2. Open content script DevTools → Console → switch to extension context
3. Run `PrivacyBlurEngine.blurAllContent(8)` — does it work directly?
4. If yes: the message from popup/background isn't reaching the content script
5. Check background service worker DevTools for errors
6. After code changes: did you reload the extension at `chrome://extensions`?

### "Form fields not blurred"
1. Check `settings.blurCategories.form` — is it `false` (default)?
2. Open popup → Blur Categories → toggle Form ON
3. Click Blur All again

### "Content layer stays blurred on hover"
1. Check that dynamically added elements have `pb-reveal-on-hover` class
2. Run: `document.querySelectorAll('.pb-blurred:not(.pb-reveal-on-hover)').length`
3. If > 0: elements were blurred by the MutationObserver before RAF chunk added the class
4. Check that `settings.revealOnHover` is `true`

### "Page freezes during SPA navigation"
1. The batched MutationObserver should prevent this
2. Check CHUNK_SIZE (default 50) — lower it if pages still freeze
3. Run DevTools Performance recording during navigation to see if processBlurChunk is taking too long

### "Popup shows hostname as —"
1. The popup can't find an http/https tab
2. Check if the page is a chrome:// or extension:// URL
3. Open popup DevTools → Console → check for errors

### "Settings don't persist"
1. Open background service worker console
2. Run `chrome.storage.local.get('settings', console.log)`
3. Change a setting in the popup
4. Run the get command again — did it update?

### "Blur doesn't restore after reload"
1. Check storage: `chrome.storage.local.get('blurred_selectors', console.log)`
2. Look for the hostname — are selectors saved?
3. Set a breakpoint in `restoreBlurredElements()` in content_script.js
4. Reload the page — does the breakpoint hit?

---

## File Map

```
privacyblur/
├── manifest.json           ← Extension config, permissions, content script load order
├── background.js           ← Service worker: storage, commands, context menu
├── src/
│   ├── constants.js        ← Message types, DEFAULTS (blur categories, thorough blur)
│   ├── selector_utils.js   ← CSS selector generation for persistence
│   ├── storage_manager.js  ← Async API wrapping chrome.runtime.sendMessage
│   ├── blur_engine.js      ← DOM manipulation: category-based blur (CSS + canvas)
│   ├── shortcut_handler.js ← Chord keyboard shortcut detection (Ctrl+K → V)
│   ├── picker.js           ← Interactive hover-and-click element picker
│   └── content_script.js   ← Orchestrator: binds modules, handles messages, batched observer
├── popup/
│   ├── popup.html          ← Popup UI markup (settings + category toggles)
│   ├── popup.js            ← Popup controller: settings, categories, blur list
│   └── popup.css           ← Dark theme styles
├── styles/
│   └── content.css         ← Injected page styles (pb-blurred, pb-ancestor-reveal, etc.)
├── tests/
│   ├── setup.js            ← Jest mocks for chrome.*, canvas, rAF
│   ├── unit/               ← 228 unit tests (6 test files)
│   └── e2e/                ← 4 e2e tests (Puppeteer + real Chrome)
├── docs/
│   ├── HLD.md              ← High-level architecture
│   ├── LLD.md              ← Module contracts
│   ├── BLUR_CATEGORIES.md  ← Category taxonomy and element lists
│   ├── CROSS_BROWSER.md    ← Chrome/Firefox compatibility
│   ├── TEST_VALIDATION.md  ← Test entries with manual replication steps
│   └── DEV_GUIDE.md        ← This file
└── CLAUDE.md               ← Claude Code instructions, module globals, settings shapes
```
