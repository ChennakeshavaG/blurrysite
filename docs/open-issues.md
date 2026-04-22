# Open Issues

Consolidated from code-review audits. Verified against current source as of 2026-04-22.

---

## Performance

| Issue | File | Detail |
|---|---|---|
| `querySelectorAll('*')` on every MO mutation | `blur_engine.js:919` | Queries all descendants per added node in MutationObserver callback — should filter to relevant tags only |
| Full DOM scan on blur-all toggle | `blur_engine.js:463` | `stampElements` does unconditional `querySelectorAll('*')` — no idle batching |
| `closest()` called per element in bulk scans | `blur_engine.js:539–544` | `_isExtensionUI` does two `closest()` calls on every element; toolbar/toast presence could be cached |
| `isBlurred` linear scan instead of Set lookup | `blur_engine.js:593–594` | Loops through `alwaysBlurTags[]` — should use `tagSet` for O(1) |
| Full re-blur on any settings change | `blur_engine.js` | No per-category diff; full reconcile runs even when an unrelated setting changes |

---

## Bugs

| Issue | File | Detail |
|---|---|---|
| `isBlurAllActive()` desyncs if `<style>` removed externally | `blur_engine.js:441` | Checks `document.head.querySelector` only; no re-inject on external desync |
| `GET_STATUS` misses CSS-rule-blurred element count | `content_script.js` | `querySelectorAll('[data-bl-si-blur]')` only counts data-attribute blurs, not tag-rule blurs (h1, p, img, etc.) |
| `hasMeaningfulTextContent` ignores `display:none` | `blur_engine.js:220–230` | Checks `textContent` only; invisible elements still pass the text check |
| `deepMerge` passes unknown keys silently | `src/constants.js:231` | Skips only `__proto__/constructor/prototype`; typos like `typo_blur_radius` merge through without warning |
| Picker hover highlight not cleared when target is null | `picker.js:684–703` | When `resolveTarget` returns null, previous hover highlight element is not cleared |
| Unused `radius` arg in picker's `applyBlur` call | `picker.js:759` | Passes `activeSettings.blurRadius` but `blur_engine.js:563` accepts only one argument |

---

## Memory Leaks

| Issue | File | Detail |
|---|---|---|
| `_unrevealElement` setTimeout not cleaned on `destroy()` | `reveal_controller.js:350` | Timer created without cleanup tracking; fires after reveal controller is destroyed |
| Picker `selectedElements` Set holds strong DOM refs | `picker.js:54` | `new Set()` holds strong element references; not cleared on SPA navigation |

---

## Cleanup

| Issue | File | Detail |
|---|---|---|
| Unused i18n keys in `popup.json` | `_locales/en/popup.json` | `section_general`, `section_advanced`, `section_experimental` present but never used |

---

## Missing Tests

| Issue | Detail |
|---|---|
| Concurrent blur-all + picker state | No test for blur-all ON while picker is active simultaneously |
| SPA navigation persistence | Blur state persistence across `history.pushState` not covered |
