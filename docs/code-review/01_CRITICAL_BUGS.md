# Code Review: Critical Bugs

Issues that cause crashes, data loss, or broken functionality.

## 0. Firefox: background.js crashes — importScripts undefined
**File:** `background.js:3`
**Severity:** CRITICAL — breaks ALL Firefox functionality

```js
importScripts('src/constants.js', 'src/logger.js');
```

Firefox MV3 uses event pages (DOM context), NOT service workers. `importScripts()` is a `WorkerGlobalScope`-only API — it throws `ReferenceError: importScripts is not defined` in Firefox.

**Impact:** Entire background script crashes on line 3. No message handlers registered. ALL storage operations fail silently:
- Picker blurs aren't saved → blurred elements list empty
- Settings not loaded/saved
- Rules not loaded/saved
- Blur-all state not persisted

The blur visually works (content script is fine) but nothing persists.

**Fix:** List dependencies in manifest `scripts` array (Firefox loads them in order like `<script>` tags), and guard the `importScripts` call:

```json
"background": {
  "service_worker": "background.js",
  "scripts": ["src/constants.js", "src/logger.js", "background.js"]
}
```

```js
// background.js line 3
if (typeof importScripts === 'function') {
  importScripts('src/constants.js', 'src/logger.js');
}
```

**Also:** Popup tab query uses `lastAccessed` sort instead of `{ active: true, currentWindow: true }` — `lastAccessed` can be undefined on Firefox discarded tabs.

## 1. removeBlur() doesn't override CSS tag rules
**File:** `src/blur_engine.js:269-273`
**Severity:** HIGH

`removeBlur()` only deletes `data-pb-blur` attribute. If blur-all is active, CSS tag rules (`p { filter: blur() }`) still apply. The element remains visually blurred despite calling removeBlur.

**Affects:** Picker X button, context menu unblur, UNBLUR_SELECTOR message.

---

## 2. storage_manager returns undefined instead of Promise
**File:** `src/storage_manager.js:50-58`
**Severity:** HIGH

`saveBlurredElement()` and `removeBlurredElement()` return `undefined` (not a Promise) when arguments are null/empty. Callers use `.catch()` on the return value → crash.

---

## 3. CONTEXT_UNBLUR crashes if target is null
**File:** `src/content_script.js:642`
**Severity:** HIGH

`findBlurredAncestor(target)` called when `target` could be null (lastContextMenuTarget cleared). `el.parentElement` on null → runtime error.

---

## 4. serialWrite queue can stall forever
**File:** `background.js:116-118`
**Severity:** CRITICAL

If a `chrome.storage.local` callback never fires (error/crash), the Promise never resolves. All subsequent writes block indefinitely.

---

## 5. E2E tests call removed API: blurAllContent()
**File:** `tests/e2e/observer_pipeline.spec.js:139`, `tests/e2e/mutation_loop.spec.js`
**Severity:** CRITICAL (tests)

Tests call `pb.BlurEngine.blurAllContent()` which no longer exists. Should use `injectBlurRules()` + `blurTextCheckElements()`.

---

## 6. E2E tests check dead class .pb-blurred
**File:** `tests/e2e/blur.spec.js` (10+ assertions)
**Severity:** CRITICAL (tests)

Tests verify `classList.contains('pb-blurred')` but new system uses `data-pb-blur` attribute.

---

## 7. Print CSS references dead .pb-blurred class
**File:** `styles/content.css:285-288`
**Severity:** MEDIUM

```css
@media print { .pb-blurred { ... } }
```
Should be `[data-pb-blur]`.

---

## 8. Rule modal listeners stack on multiple opens
**File:** `popup/popup.js:561-615`
**Severity:** HIGH

Opening the rule modal twice without closing adds duplicate `click` listeners to Save/Cancel buttons. Clicking Save fires handler twice.

---

## 9. _revealedElements Set memory leak
**File:** `src/content_script.js:374-379`
**Severity:** HIGH

`_revealElement()` adds all blurred descendants to the Set. `_unrevealElement()` only removes the parent — children leak. After 100 reveal cycles, Set holds 50k+ stale references.

---

## 10. Picker can't detect CSS-rule-blurred elements
**File:** `src/picker.js:199`
**Severity:** HIGH

Picker checks `target.dataset.pbBlur` only. Elements blurred by CSS tag rules (blur-all) have no data attribute — picker sees them as "not blurred" and offers to blur again.
