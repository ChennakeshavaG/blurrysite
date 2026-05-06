# Blurry Site — Claude Instructions

## What This Project Is

Chrome/Firefox MV3 extension. Vanilla JS only — no bundler, no ES modules, no TypeScript.
All source files IIFEs assigning single `window.BlurrySite*` global.

Per-module contracts: `docs/contracts/<module>.md` (one per module — read during implementation). Index: `docs/contracts/README.md`.

---

## Before Any Change

1. Run tests first, confirm green baseline: `npm run test:unit`
2. **Read contract first** — hook fires automatically on every Edit/Write to src/. Full rules: `.claude/rules/code-contracts.md`.
3. Adding new `chrome.runtime.sendMessage` type — checklist in `.claude/rules/message-protocol.md`.

---

## Quick Reference (detail lives in folder-specific files)

| Topic | File | Auto-loads for |
|---|---|---|
| Module globals, load order, IIFE pattern, CSS classes, per-module rules | `src/CLAUDE.md` | — (loaded when working in src/) |
| Settings shape (model, resolve, session storage) | `.claude/rules/settings-shape.md` | storage_model, popup, background, content_script, automate |
| Message protocol (type tables, add-new-type checklist) | `.claude/rules/message-protocol.md` | src/, background.js, popup/ |
| Code contracts (read-before-edit hook) | `.claude/rules/code-contracts.md` | src/, popup/, tests/, background.js |
| Popup rules, APIs, CSS conventions | `popup/CLAUDE.md` | — (loaded when working in popup/) |
| Testing patterns, mocks, coverage | `tests/CLAUDE.md` | — (loaded when working in tests/) |

---

## Critical: Module Globals

Every source file exposes exactly one window global. Wrong name → silent `undefined` crash in page context.
Full table and load order: `src/CLAUDE.md`. Load order fixed by `manifest.json` — never reorder.

---

## Critical: Chrome API Error Logging

Every `chrome.*` async API call must check `chrome.runtime.lastError` in its callback (or `.catch()` on promise form). **Never use `void chrome.runtime.lastError`** — always log via `blsi.Logger`:

```js
// Callback pattern — use scoped logger (log = blsi.Logger.scope('xxx'))
chrome.some.api(..., () => {
  if (chrome.runtime.lastError) {
    log.warn('descriptive tag', chrome.runtime.lastError.message);
    return; // bail if the callback does real work
  }
  // ... success path
});

// Promise pattern
chrome.some.api(...).catch(e => log.warn('descriptive tag', e && e.message));
```

Unchecked `lastError` causes Chrome to log noisy "Unchecked runtime.lastError" warnings. Silent `void` discards useful debugging signal. `log.warn` respects the debug toggle — errors surface only when flow logging is enabled, keeping the console clean for users.

---

## Critical: Message Protocol

**Sender/handler type mismatch silently drops message — no error.** Full tables and add-new-type checklist: `.claude/rules/message-protocol.md` (auto-loaded when touching src/, background.js, or popup/).

---

## Spawning Sub-agents

Sub-agents get CLAUDE.md loaded but task prompt overrides attention to rules. For any Agent call touching src/ or popup/:

1. Name the specific contract in the prompt: `"read docs/contracts/<module>.md before proposing changes"`
2. For Explore agents: end with `"Report only — no edits"`
3. For Plan agents: add `"plan must respect: no ES modules, IIFEs only, load order fixed in manifest.json"`

---

## Firefox Compatibility Rules

- Use only `chrome.*` namespace (Firefox 109+ exposes as compatibility shim).
- Do NOT use `browser.*` — Chrome lacks it.
- Service worker (`background.js`) must be stateless between wake cycles — never store mutable state in module-level variables in background.js.
- Always guard against `moz-extension://` URLs in background.js tab listeners (already done).
- Test shortcut behaviour: `Ctrl+K` may conflict with Firefox address bar on some platforms; document in release notes.

---

## Documentation Maintenance

Docs are load-bearing references used by humans and Claude. Code changes → relevant docs MUST update in same change.

### When to update which doc

| What changed | Update |
|---|---|
| Added/removed/renamed public API method on any module | `src/CLAUDE.md` Module Globals + load order, `docs/contracts/<module>.md` contract |
| Added/removed `chrome.runtime.sendMessage` type | `src/constants.js` (source of truth), `.claude/rules/message-protocol.md` |
| Changed default value (blur radius, chord keys, etc.) | `src/constants.js` DEFAULTS — all other files reference it |
| Changed settings shape (new keys, renamed keys) | `.claude/rules/settings-shape.md`, `docs/contracts/storage_model.md` |
| Added/removed/renamed `blsi.Model` method or storage key | `src/CLAUDE.md` storage_model.js rules, `docs/contracts/storage_model.md` contract |
| Added new source file under `src/` | `src/CLAUDE.md` load order + Module Globals, `manifest.json` content_scripts |
| Added/modified/removed unit test | `docs/contracts/<module>.tests.md` — describe groups, edge cases, known gaps |
| Added new test file | `docs/contracts/<module>.tests.md` new file, `tests/CLAUDE.md` if test patterns differ |
| Changed test loading pattern or setup | `tests/CLAUDE.md` |
| Changed keyboard shortcut handling | `.claude/rules/settings-shape.md`, `src/CLAUDE.md` shortcut_handler rules |
| Changed CSS class names or IDs | `src/CLAUDE.md` CSS Class Constants table |
| Changed Firefox compatibility behavior | `CLAUDE.md` Firefox Compatibility Rules |
| Found new known limitation | `CLAUDE.md` Known Limitations table |

### Rules

1. **Same-commit rule** — doc updates go in same commit as code change. Never leave docs for follow-up.
2. **Update, don't append** — behavior changes: find and update existing entry. Don't add contradicting entry.
3. **Don't document internals** — only document things affecting how other code interacts with module (public API, message types, settings shapes, CSS classes). Private details in code comments, not docs.

---

## Known Limitations (do not "fix" without understanding the tradeoff)

| Issue | Root cause | Status |
|---|---|---|
| ~~DRM video shows dark overlay~~ | Fixed — CSS `filter: blur()` works on DRM video (DRM blocks pixel extraction, not CSS rendering) | Resolved |
| SPA selector staleness | Dynamic blur items store `selectors: string[]` ordered structural→semantic. Structural (nth-of-type) paths fail when SPA re-renders DOM; fallback selectors (class, aria, data-*, id) survive. Elements with no stable signals show "may not persist" warning in picker on hover. | Partially mitigated — picker shows warning; full SPA resilience requires semantic signals on element |
| Context menu blur has no element targeting | `contextMenus.onClicked` does not capture `targetElementId` in current impl | Known gap — `docs/browser-compatibility.md §6.6` |
| `position: fixed` inside blurred containers shifts | CSS `filter` creates stacking context — browser spec behaviour | User education in README |
| `position: sticky` inside blurred containers stops sticking | CSS `filter` creates stacking context — spec behaviour | Same root cause as `position: fixed` issue |
| `<select>` dropdown options visible when opened | CSS filter only blurs closed state | Known limitation |
| ~~Reveal may strip element background color~~ | Fixed — reveal rules now clear `background-color` only for the modes that set one (color pick-blur, redacted/censored blur-all). Blur and frosted modes leave the page's background untouched during reveal. | Resolved |
| Hover reveal and click reveal work inside shadow roots; picker does not | `reveal_controller` uses `event.composedPath()[0]` to pierce shadow DOM retargeting — reveal reaches elements inside shadow roots. `picker` still uses `event.target`, cannot reach inside shadow roots. | Hover/click reveal: fixed. Picker: Phase 2 |
| `isBlurred()` returns false for alwaysBlur elements inside shadow roots | `isBlurAllActive()` checks `document.head` only; elements blurred by CSS injected into shadow root undetected. Picker can't reach them until Phase 2. | Phase 2 |
| Zone overlays misalign on pages with CSS `transform` on ancestor elements | `position:absolute` coordinate space anchors to nearest transformed ancestor, not document root — CSS spec behaviour | Known limitation — `position:fixed` screen-anchor zones unaffected; page-anchor zones may appear offset on transform-heavy pages (rare) |
| Picker cannot reach into iframes | Picker uses `event.target`, guarded to main frame only (`IS_MAIN_FRAME`) — zone drawing cannot cross frame boundaries | Phase 2 |
| Keyboard shortcuts don't fire when focus inside cross-origin iframe | Browser delivers keydown to focused frame; shortcut handler is main-frame only | Phase 2 |
| Cross-origin iframes with strict `Referrer-Policy` may not blur on initial load | `document.referrer` empty → `_topHostname` starts empty → blur-all state unknown until postMessage from main frame arrives | Acceptable — resolves within milliseconds once main frame init completes |
| SPA navigation inside iframes not tracked | `history.pushState` wrapping and popstate/hashchange listeners are main-frame only — URL rule overrides don't update if iframe does SPA navigation | Phase 2 |
| Opening the extension popup briefly blurs the page when `automate.tab_switch` is on | `window.blur` fires when focus moves to the popup; the per-tab Visibility observer cannot detect own-extension focus from page context. | Acceptable tradeoff — consistent with privacy intent (anyone shoulder-surfing during settings adjustment sees blurred content). Future mitigation: background broadcasts a `popup-opened` flag to suppress the next `passive` for ~500ms. |
| Extension cannot run on Chrome-restricted URLs (Chrome Web Store, `chrome://*`, `chrome-extension://*`, `about:`, `view-source:`, devtools, etc.) | Browser policy — `host_permissions: ["<all_urls>"]` does NOT grant injection on these URLs. Extensions are physically blocked at the platform level. | Mitigated — popup detects via `blsi.UrlMatcher.isRestrictedUrl(tab.url)` and renders a dedicated empty-state view; `background.js _reinjectAllTabs` skips these tabs |
| MAIN-world bridge runs late on tabs already open at install/update time | `chrome.scripting.executeScript` cannot retroactively run at `document_start`; any `getDisplayMedia` / `attachShadow` already executed in those tabs goes un-hooked. Subsequent navigations get the static `document_start` injection correctly. | Acceptable — install-time recovery prioritises the common case (page idle waiting for blur to apply); resolves on next nav |
| PII auto-detect cannot scan text rendered inside `<canvas>` | Canvas contents are a 2D bitmap drawn by JS — there are no DOM text nodes for `pii_detector`'s `TreeWalker(SHOW_TEXT)` to enumerate, and the browser blocks bitmap pixel extraction by design (DRM/privacy). OCR is not viable in-extension (size, perf, latency). | Fundamental — not fixable. Workaround: enable blur-all with the `media` category on, which blurs the entire `<canvas>` element via CSS `filter: blur()`. Pick-blur (selector-based) and screenshot capture continue to work on canvas. |
