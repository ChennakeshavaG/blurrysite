# Audit Round 2 — Remaining Findings

**Date:** 2026-04-07
**Scope:** Full codebase — 3 parallel agents (bugs/logic, performance, popup/UI)
**Fixed in this round:** Critical #1 (wrong tab query), Critical #2 (context unblur target) — commit `6bbb23d`

---

## HIGH Priority

### H1. MutationObserver `querySelectorAll('*')` per added node
**File:** `content_script.js:93-95`
```js
const children = node.querySelectorAll('*');
for (let i = 0; i < children.length; i++) {
  Engine.tryBlurTextCheck(children[i], settings.THOROUGH_BLUR);
}
```
**Problem:** On SPAs (Twitter, Gmail), framework renders insert large subtrees. A single mutation batch can have hundreds of nodes, each triggering `querySelectorAll('*')`. O(N*M) where N=added nodes, M=avg subtree size.

**Real-world impact:** Twitter infinite scroll inserts ~20 tweet containers averaging 30 children = 600 elements queried + checked per scroll batch. Causes jank on main thread.

**Fix direction:** Replace `querySelectorAll('*')` with `querySelectorAll(textCheckSelector)` from the cache — queries only tags that `tryBlurTextCheck` would accept. Additionally, consider batching with `requestIdleCallback`.

---

### H2. Full-document scan on blur-all toggle
**File:** `blur_engine.js:241`
```js
document.querySelectorAll(textCheckSelector).forEach(el => { ... });
```
**Problem:** `textCheckSelector` joins ~30 tag names. On large pages (Wikipedia, Gmail), this returns 10K-50K elements. Each is checked with `_isExtensionUI` (which does `closest()` — ancestor walk) and `hasMeaningfulTextContent` (iterates `childNodes`). Runs synchronously.

**Real-world impact:** Alt+Shift+B on a large Wikipedia article freezes the page for 100-500ms.

**Fix direction:** Break into chunks of ~500 elements per `requestIdleCallback`. CSS tag rules already apply instantly; text-check stamping can be deferred without visible delay.

---

### H3. Picker button state diverges from reality
**File:** `popup.js:321-326`
```js
chrome.tabs.sendMessage(currentTab.id, { type: MSG.TOGGLE_PICKER }).catch(() => {});
isPickerActive = !isPickerActive;  // local toggle, fire-and-forget
```
**Problem:** If message fails (tab crashed, restricted URL), popup shows picker as active when it never activated.

**Fix direction:** Use `.then()` on sendMessage to confirm, or re-query `GET_STATUS` after toggle. Reset on `.catch()`.

---

## MEDIUM Priority

### M1. `async sendResponse` leak on error
**File:** `content_script.js:604-628`
**Problem:** UPDATE_SETTINGS handler runs in async IIFE, returns `true` to keep channel open. If `applyState()` throws, `sendResponse` is never called — channel leaks.

**Fix direction:** Wrap entire async body in try/catch, call `sendResponse({ ok: false })` in catch.

---

### M2. `isBlurAllActive()` desyncs if `<style>` removed externally
**File:** `blur_engine.js:223-225`
```js
return _styleEl !== null && _styleEl.parentNode !== null;
```
**Problem:** If another extension or page script removes `<style id="pb-blur-styles">`, `isBlurAllActive()` returns false but `isPageBlurred` in content_script stays true. `isBlurred()` for always-blur tags returns false, hover reveal breaks.

**Fix direction:** Check only `_styleEl !== null` (internal state), or re-verify/re-inject on desync.

---

### M3. DOM observer started unconditionally
**File:** `content_script.js:824`
**Problem:** `startDomObserver()` called in `init()` regardless of blur-all state. The callback has `if (!isPageBlurred) return` guard but still fires on every DOM mutation.

**Fix direction:** Only start observer when blur-all is activated. Remove the unconditional call from init. Already started correctly in TOGGLE_BLUR_ALL and restore-blur-state blocks.

---

### M4. `_isExtensionUI` does `closest()` per element in bulk scans
**File:** `blur_engine.js:270-275`
```js
return element.id === toolbarId || element.closest('#' + toolbarId) ||
       element.classList.contains(pb.CSS.TOAST) || element.closest('.' + pb.CSS.TOAST) ||
       element.classList.contains(pb.CSS.TOOLBAR);
```
**Problem:** Two `closest()` calls per element during `blurTextCheckElements`. On 30K elements, that's 60K ancestor walks. Toolbar/toast only exist when picker is active (rare during blur-all).

**Fix direction:** Cache whether toolbar/toast exist at start of bulk scan. Skip all `closest()` calls if they don't exist (common case).

---

### M5. Reveal functions use `querySelectorAll('*')`
**File:** `content_script.js:374,387`
**Problem:** `_revealElement` queries all descendants to find blurred ones. `_unrevealElement` queries all descendants to find tracked ones. Expensive on large containers.

**Fix direction:** For `_revealElement`, query `[data-pb-blur]` + always-blur tag selector. For `_unrevealElement`, filter `_revealedElements` Set for descendants of `el` instead of querying DOM.

---

### M6. Full re-blur on any settings change
**File:** `content_script.js:738-746`
**Problem:** Changing one category runs `unblurAll()` → `injectBlurRules()` → `blurTextCheckElements()` — full-page double scan. Causes visible flash + jank.

**Fix direction:** For category changes, compute diff and only stamp/unstamp changed categories. For mode changes, only re-inject `<style>` (data attributes unchanged).

---

### M7. ReDoS risk in regex URL rules
**File:** `content_script.js:260-270`
**Problem:** Heuristic catches `(a+)+` but not all catastrophic patterns (e.g., `(a|a)*b`). A bad regex rule freezes the content script on every page load.

**Fix direction:** Run regex with a timeout (Web Worker or `setTimeout` abort), or disallow regex entirely and use only glob patterns.

---

### M8. Theme toggle loses "auto" mode permanently
**File:** `popup.js:267-271`
**Problem:** Toggling theme stores `'dark'` or `'light'` — never `'auto'` again. No way to restore system-preference-following.

**Fix direction:** Three-way cycle: auto → light → dark → auto.

---

### M9. Missing `aria-label` on action buttons
**File:** `popup.html` lines 52, 59, 66
**Problem:** Blur-all, Clear-all, Picker buttons have no accessible labels. Screen readers announce the button but not its purpose.

**Fix direction:** Add `aria-label` to each action button.

---

### M10. Section headers not translatable
**File:** `popup.html` lines 84, 93, 104, 119
**Problem:** "Keyboard Shortcuts", "Settings", "URL Rules", "Blurred Elements" are hardcoded English.

**Fix direction:** Add `data-i18n` attributes, add keys to `_locales/en/popup.json`.

---

### M11. `web_accessible_resources` exposes locale files
**File:** `manifest.json:85-88`
**Problem:** `_locales/*/*.json` accessible to all websites — enables extension fingerprinting.

**Fix direction:** Test removing the WAR entry. `chrome.runtime.getURL()` from popup/extension pages works without it. If content scripts need it, restrict `matches`.

---

## LOW Priority

### L1. `storage.onChanged` deep-merges instead of replacing
**File:** `content_script.js:876`
**Problem:** `globalSettings = MSG.deepMerge(globalSettings, changes.settings.newValue)` — if a key is removed in another tab, old value persists. Currently safe because `validateSettings` always produces complete objects.

**Fix direction:** Replace instead of merge: `globalSettings = changes.settings.newValue`.

---

### L2. `_unrevealElement` setTimeout not cleaned on disable
**File:** `content_script.js:384`
**Problem:** 120ms timer for transition cleanup fires after disable/navigation. Harmless on detached nodes but accumulates.

**Fix direction:** Track timeout ID, clear on `_unrevealAll()`.

---

### L3. Empty hostname on `file://` URLs
**File:** `content_script.js:43`
**Problem:** `location.hostname` is `""` on `file://` pages. Storage ops return early. Blur-all works in-memory but doesn't persist.

**Fix direction:** Use fallback key like `"__local__"` or full URL hash.

---

### L4. Unused radius argument in `applyBlur` call
**File:** `picker.js:213` calls `applyBlur(target, activeSettings.blurRadius)` but `blur_engine.js:279` only accepts `(element)`.

**Fix direction:** Remove unused second argument from call site.

---

### L5. Picker `selectedElements` Set holds strong DOM refs
**File:** `picker.js:27`
**Problem:** SPA navigation removes DOM nodes but Set retains references. Cleared on deactivate, but leaks during active picker + SPA nav.

**Fix direction:** Use WeakSet (not iterable — restructure `clearAllFromPicker`), or clear on URL change.

---

### L6. Picker `onMouseOut` doesn't clear highlight when target is null
**File:** `picker.js:160-167`
**Problem:** If `e.target` is `<body>`, `resolveTarget` returns null. Previous element keeps highlight class.

**Fix direction:** When target is null, always remove highlight from `hoveredElement` and nullify.

---

### L7. `activeRule` element bound but never populated
**File:** `popup.html:78`, `popup.js:49`
**Problem:** Empty `<span id="activeRule">` in UI — no code writes to it. Missing feature.

**Fix direction:** After resolving settings in init, check if a URL rule matches and display its name.

---

### L8. `isBlurred` linear scan of `alwaysBlurTags`
**File:** `blur_engine.js:308-312`
**Problem:** Linear scan of ~15 tags per call. Compounds with `querySelectorAll('*')` in reveal functions.

**Fix direction:** Add `alwaysBlurTagSet` (Set) to `buildSelectors` for O(1) lookup. The `tagSet` already exists but includes text-check tags.

---

## Performance Optimization Priorities

| Priority | Fix | Estimated Improvement |
|---|---|---|
| 1 | MO: `querySelectorAll(textCheckSelector)` instead of `('*')` | 50-80% fewer elements checked per mutation |
| 2 | Blur-all: chunk scan with `requestIdleCallback` | Eliminates page freeze on large pages |
| 3 | Observer: only start when blur-all active | Zero overhead on normal browsing |
| 4 | `_isExtensionUI`: cache toolbar/toast existence | ~30% faster bulk scan |
| 5 | Reveal: targeted selectors instead of `('*')` | Smoother hover transitions |
| 6 | `isBlurred`: Set lookup instead of array scan | Marginal per-call, compounds at scale |
