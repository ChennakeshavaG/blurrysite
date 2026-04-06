# Research: Picker Click/Hover Unblur Failure

**Date:** 2026-04-07
**Fixed in:** commit `4268fa1`

---

## Problem Statement

When the picker is active and the user clicks an already-blurred element, the element does not get unblurred. The hover highlight also doesn't match the element that would be affected by the click.

## Root Cause Analysis

### The `findClassedParent` walk

`picker.js:175-186` — When the user clicks an element, the picker walks UP the DOM to find the nearest parent with a CSS class (for stable selector persistence):

```
User clicks: <span data-pb-blur="1">email@test.com</span>
                   ↑ this is blurred

findClassedParent walks up to: <div class="card">
                                    ↑ this is NOT blurred
```

The isBlurred check then runs on `<div class="card">` → returns `false` → picker tries to BLUR it instead of unblurring the span.

### Why this worked before

Before the thorough blur rework, structural containers like `<div class="card">` were also stamped with `data-pb-blur` in thorough mode. So `findClassedParent` returning the div still resulted in `isBlurred` returning true. After we stopped stamping structural containers (commit `da2ad7b`), the parent div no longer has `data-pb-blur`, exposing this bug.

### Hover-click mismatch

`onMouseOver` (line 149) highlights `e.target` directly — no `findClassedParent` call. But `onClick` (line 188) changes the target via `findClassedParent`. So the user sees the highlight on the span, clicks, but the picker operates on the parent div.

## Code Flow (Before Fix)

```
onClick(e)
  → target = resolveTarget(e.target)     // <span data-pb-blur="1">
  → target = findClassedParent(target)   // walks up to <div class="card">
  → isBlurred(target)                    // false — div has no data-pb-blur
  → onBlur(target)                       // WRONG: blurs the div instead of unblurring the span
```

## Fix Applied

**Click (line 188-200):** Check `isBlurred` on the original target FIRST. Only walk up to `findClassedParent` for new blurs (where a stable selector is needed). Already-blurred elements are operated on directly — they already have a stored selector.

**Hover (line 149-158):** Match the click logic — if the hovered element is blurred, highlight it directly. If not, highlight the classed parent that would be blurred on click.

## Code Flow (After Fix)

```
onClick(e)
  → target = resolveTarget(e.target)     // <span data-pb-blur="1">
  → isBlurred(target)                    // true — has data-pb-blur
  → (skip findClassedParent)
  → onUnblur(target)                     // CORRECT: unblurs the span
```

```
onClick(e) — new blur case
  → target = resolveTarget(e.target)     // <span> (no blur)
  → isBlurred(target)                    // false
  → target = findClassedParent(target)   // walks up to <div class="card">
  → onBlur(target)                       // blurs the div with stable selector
```

## Edge Cases Considered

| Scenario | Before fix | After fix |
|---|---|---|
| Click blurred `<span>` inside `<div class="card">` | Blurs div (wrong) | Unblurs span (correct) |
| Click unblurred `<span>` inside `<div class="card">` | Blurs div (correct) | Blurs div (correct, stable selector) |
| Click element blurred by CSS tag rule (`<p>` in blur-all) | findClassedParent returns parent, isBlurred false (wrong) | isBlurred true on `<p>` (correct, CSS tag rule detected) |
| Click class-less element with no blurred ancestor | findClassedParent returns self (correct) | isBlurred false, findClassedParent returns self (correct) |
| Hover highlight → click | Highlight on span, click operates on div (mismatch) | Both highlight and click operate on same element |

## Related Issues

- **findClassedParent design:** It exists so that selectors persist across page reloads (framework-rendered class names are stable). This purpose is only needed for NEW blurs, not for unblurring existing elements.
- **Audit finding L4:** `applyBlur` called with unused radius argument — related but separate issue.
- **Audit finding #6:** findClassedParent returns unstable selectors for class-less elements — known limitation, not addressed here.
