# Plan: Mode-Aware Reveal Controller

**Status:** Implemented
**Problem:** Hover/click reveal does nothing for Redacted and Masked blur modes.

---

## Root Cause

`reveal_controller.js` reveals by setting inline `style.filter = 'none'` on the element.
This only cancels `filter: blur()` (Gaussian) and `filter: url(#frosted)` (Frosted).

Redacted hides via `background-color`, `color: transparent`, `border-color`, `text-decoration-color`.
Masked hides via `font-size: 0` + `::after` pseudo-element gated by `data-bl-si-mask-text` attribute.
Neither uses `filter` for text elements — `filter: none` has zero effect.

Media elements (img, video, canvas, svg) use `filter: brightness(0)` in all non-gaussian modes, so `filter: none` does work for media — but not for text.

---

## Design: Attribute-Driven Reveal (No JS Mode Branching)

### Core Insight

The blur system already uses data attributes + CSS rules — not inline styles — to apply blur.
Reveal should follow the same pattern: stamp `data-bl-si-reveal="1"`, let CSS do the work.

### Why All Overrides Can Live in One CSS Block

The reveal attribute rule overrides properties from ALL four modes simultaneously.
This is safe because the overrides are no-ops when the property isn't set by the active mode:

| Override | Gaussian/Frosted | Redacted | Masked |
|----------|-----------------|----------|--------|
| `filter: none` | Cancels blur | No-op (no filter on text) | No-op (no filter on text) |
| `background-color: transparent` | No-op (element keeps its own bg) | Cancels black block | No-op |
| `color: inherit` | No-op | Cancels `color: transparent` | No-op |
| `font-size: inherit` | No-op | No-op | Cancels `font-size: 0` |
| `border-color: inherit` | No-op | Cancels redaction border | No-op |
| `text-decoration-color: inherit` | No-op | Cancels redaction text-decoration | No-op |
| `user-select: auto` | Cancels `user-select: none` | Same | Same |

For masked `::after`, a second CSS rule kills the pseudo-element:
```css
[data-bl-si-reveal][data-bl-si-mask-text]::after {
  content: none !important;
}
```
This only matches when BOTH attributes are present — no false positives.

For media elements in redacted/masked modes (which use `filter: brightness(0)`),
the `filter: none` override already covers them.

### Reveal Flow

**Reveal:** `el.dataset.blSiReveal = '1'` — CSS takes over, all modes handled.
**Unreveal:** `delete el.dataset.blSiReveal` — element re-blurs via existing CSS rules.

No `getBlurMode`, no mode branching, no stored original styles, no re-stamping attributes.

### Why This Eliminates the Mode-Switch Edge Case

Old plan had a problem: if user switches from Gaussian to Redacted while an element is revealed, unreveal would clean up the wrong inline styles.

With the attribute approach, there are no inline styles to clean up. The reveal attribute overrides whatever blur CSS is active. When blur mode changes, `injectBlurRules` swaps the blur CSS — the reveal attribute's overrides still cancel whatever the new rules apply. Removing the reveal attribute lets the new mode's rules take effect. Zero stale state.

---

## File Changes

### `styles/content.css`

Add one block after the existing `[data-bl-si-blur]` rule:

```css
/* ─── Reveal: attribute-driven, covers all blur modes ──────────────────────── */

[data-bl-si-reveal] {
  /* Gaussian / Frosted */
  filter: none !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
  /* Redacted */
  background-color: transparent !important;
  color: inherit !important;
  border-color: inherit !important;
  text-decoration-color: inherit !important;
  /* Masked */
  font-size: inherit !important;
  /* All modes */
  user-select: auto !important;
}

/* Kill masked-mode asterisks on revealed elements */
[data-bl-si-reveal][data-bl-si-mask-text]::after {
  content: none !important;
}
```

Also add to the injected `<style>` in `blur_engine.js injectBlurRules()` — same rules.
The static CSS covers picker/individual blurs; the injected rules cover blur-all tags.
The injected rules use the same selectors, so they override both `alwaysBlurSelector` and
`[data-bl-si-blur]` rules regardless of specificity ordering.

### `src/reveal_controller.js`

| Change | Detail |
|--------|--------|
| Rewrite `_revealElement` | Replace inline `style.setProperty('filter', ...)` with `el.dataset.blSiReveal = '1'`. For children: same attribute stamp instead of inline filter. |
| Rewrite `_unrevealElement` | Replace `style.removeProperty('filter')` with `delete el.dataset.blSiReveal`. For children: same. |
| Rewrite `_unrevealAll` | Iterate `_revealedElements`, delete attribute on each. |
| Rewrite `revealAncestorChain` | Ancestors currently get inline `filter: none`. Change to `dataset.blSiReveal = '1'`. |
| Rewrite `clearRevealedAncestors` | Remove attribute instead of `style.removeProperty('filter')`. |
| Remove `_getBlurMode` | Not needed — no JS mode branching. |

**Detailed rewrites:**

```js
function _revealElement(el) {
  if (_isZoneOverlay(el)) {
    // Zones use backdrop-filter — keep as-is (no attribute equivalent)
    el.style.setProperty('backdrop-filter', 'none', 'important');
    el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
  } else {
    el.dataset.blSiReveal = '1';
    el.querySelectorAll('*').forEach(child => {
      if (_isVisuallyBlurred(child)) {
        child.dataset.blSiReveal = '1';
        _revealedElements.add(child);
      }
    });
  }
  _revealedElements.add(el);
}

function _unrevealElement(el) {
  if (_isZoneOverlay(el)) {
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
  } else {
    delete el.dataset.blSiReveal;
    el.querySelectorAll('*').forEach(child => {
      if (_revealedElements.has(child)) {
        delete child.dataset.blSiReveal;
        _revealedElements.delete(child);
      }
    });
  }
  _revealedElements.delete(el);
}

function _unrevealAll() {
  for (const el of _revealedElements) {
    if (_isZoneOverlay(el)) {
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
    } else {
      delete el.dataset.blSiReveal;
    }
  }
  _revealedElements.clear();
}

function revealAncestorChain(el) {
  clearRevealedAncestors();
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    if (_isVisuallyBlurred(node)) {
      node.dataset.blSiReveal = '1';
      revealedAncestors.push(node);
    }
    node = node.parentElement;
  }
}

function clearRevealedAncestors() {
  for (let i = 0; i < revealedAncestors.length; i++) {
    delete revealedAncestors[i].dataset.blSiReveal;
  }
  revealedAncestors = [];
}
```

### `src/blur_engine.js`

| Change | Detail |
|--------|--------|
| Add reveal override rules to `injectBlurRules()` | Append the same `[data-bl-si-reveal]` rules after the blur rules. This ensures reveal overrides always exist when blur-all is active, with correct specificity. |

Add at end of `injectBlurRules()`:
```js
// Reveal overrides — attribute-driven, covers all blur modes
rules.push(`[data-bl-si-reveal] { filter: none !important; transition: filter var(--bl-si-transition-duration, 150ms) ease !important; background-color: transparent !important; color: inherit !important; border-color: inherit !important; text-decoration-color: inherit !important; font-size: inherit !important; user-select: auto !important; }`);
rules.push(`[data-bl-si-reveal][data-bl-si-mask-text]::after { content: none !important; }`);
```

### `src/content_script.js`

**No changes.** `Reveal.init()` signature unchanged — no `getBlurMode` needed.

### `docs/CLAUDE.md`

| Change | Detail |
|--------|--------|
| Add `data-bl-si-reveal` to CSS class constants table | New attribute for reveal state |
| Update reveal_controller section in `src/CLAUDE.md` | Document attribute-based reveal |

### Tests

| File | Changes |
|------|---------|
| `tests/unit/reveal_controller.test.js` | Update existing tests: check `dataset.blSiReveal` instead of `style.filter`. Add new mode-specific tests. |

New/updated test cases:
- [ ] Reveal stamps `data-bl-si-reveal="1"`, unreveal removes it
- [ ] Reveal on children stamps attribute on blurred descendants
- [ ] Ancestor chain reveal stamps attribute, clear removes it
- [ ] Zone overlay still uses inline `backdrop-filter` (not attribute)
- [ ] Revealed element with `data-bl-si-mask-text` — `::after` suppressed (CSS test)
- [ ] Unreveal all clears attribute from every tracked element
- [ ] Mode switch while revealed — unreveal still works (no stale inline styles)

---

## What Gets Deleted

- All inline `style.setProperty('filter', ...)` calls in reveal/unreveal paths
- All inline `style.removeProperty('filter')` / `style.removeProperty('transition')` in reveal paths
- The mode-switch edge case handling (no longer exists)
- No need for `_getBlurMode`, `el._blsiRevealedMode`, `el._blsiOrigStyles`, `el._blsiHadMask`

---

## Specificity Analysis

Blur rules (injected `<style>` by blur_engine):
```
[data-bl-si-blur]              → specificity (0, 1, 0)
img:not(.bl-si-zone-overlay)   → specificity (0, 1, 1)
```

Reveal rules (injected `<style>` + static CSS):
```
[data-bl-si-reveal]                            → specificity (0, 1, 0)
[data-bl-si-reveal][data-bl-si-mask-text]::after → specificity (0, 2, 1)
```

Same specificity for the main rule — but reveal rules are injected AFTER blur rules in the same `<style>` element, so they win by source order. The `::after` rule has higher specificity than the mask rule `(0, 1, 0)`, so it wins regardless of order.

---

## Order of Operations

1. Add CSS rules to `styles/content.css`
2. Add injected rules to `blur_engine.js injectBlurRules()`
3. Rewrite reveal/unreveal functions in `reveal_controller.js`
4. Update unit tests
5. Manual test: all 4 modes with hover + click reveal
6. Update `CLAUDE.md` CSS constants table + `src/CLAUDE.md`
7. Update `docs/TEST_PLAN.md`

---

## Not In Scope

- Reveal transition animation for redacted/masked. `transition: filter` only animates gaussian/frosted. Redacted/masked snap on/off. Acceptable — the content appears instantly which feels responsive.
- Zone overlays remain inline-style based (`backdrop-filter`). There's no injected CSS for zones — they're created dynamically with inline styles. Attribute-based reveal doesn't apply to them.
