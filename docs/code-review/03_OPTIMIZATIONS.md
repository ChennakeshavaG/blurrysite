# Code Review: Optimizations

## 1. _revealElement queries all descendants with '*'
**File:** `src/content_script.js:374-379`
**Severity:** MEDIUM

`el.querySelectorAll('*')` + `Engine.isBlurred(child)` on every descendant. For a div with 1000+ children → O(n) DOM query + O(n) checks.

**Fix:** Query `[data-bl-si-blur]` instead of `*` — only data-attribute blurred descendants need inline override. CSS-rule-blurred children inherit filter:none from the parent.

---

## 2. DOM observer queries all descendants on every mutation
**File:** `src/content_script.js:91-96`
**Severity:** MEDIUM

`node.querySelectorAll('*')` for every added element. Should use a text-check tag selector instead of `*` to avoid checking non-text-check elements.

---

## 3. resolveSettings parses URL patterns repeatedly
**File:** `src/content_script.js:302-312`
**Severity:** LOW

`parsePattern()` is called for every rule on every `resolveSettings()` invocation. With 100 rules and frequent SPA navigation, this creates unnecessary parsing.

**Fix:** Pre-parse rules at load time, cache parsed results.

---

## 4. Tab query inefficient — queries all tabs then sorts
**File:** `popup/popup.js:644-648`
**Severity:** MEDIUM

Queries ALL tabs with `{ url: ['*://*/*'] }`, sorts by lastAccessed. Should use `{ active: true, currentWindow: true }` first, fallback to sort.
