# Flow Map: BlurEngine + RevealController

How `blur_engine.js` and `reveal_controller.js` work, individually and together.

---

## 1. BlurEngine — Top-Level Entry

```
content_script._reconcile()
        │
        │  folds in BLUR_ALL_ACTIVE + BLUR_ITEMS
        ▼
  handleSite(settings)
        │
        ├─ [mutex _handling] ──► DROP (concurrent call)
        │
        ├─ _currentSettings = settings
        │
        ├─ [ENABLED === false] ──► handleDocument(teardown) + _reconcileItems([]) + return
        │
        ├─ build reconcileKey
        │      blur mode | categories | thorough | (radius if frosted)
        │
        ├─ [key unchanged] ──► SKIP page-wide DOM work (CSS vars already propagated)
        │
        ├─ [key changed]
        │       └──► await handleDocument(settings, document)
        │
        ├─ _isPageBlurred = isActive
        │
        └──► _reconcileItems(settings.BLUR_ITEMS)
```

---

## 2. handleDocument(settings, root)

Runs for `document` AND every `ShadowRoot` (recursive, parallel).

```
handleDocument(settings, root)
        │
        ├─ [!ENABLED || !BLUR_ALL_ACTIVE] ──► teardown(root); return
        │
        ├─ 1. injectRules(root, cats, mode)
        │         └── see §3
        │
        ├─ 2. clear stale stamps in THIS root only
        │       root.querySelectorAll('[data-bl-si-blur]')
        │       └── delete dataset.blSiBlur (skip PII spans)
        │
        ├─ 3. stampElements(root, cats, thorough, mode)
        │         └── see §4
        │         returns ShadowRoot[] found during traversal
        │
        ├─ 4. observeRoot(root)
        │         └── see §5
        │
        └─ 5. [shadowRoots.length > 0]
                └──► Promise.all(shadowRoots.map(sr => handleDocument(settings, sr)))
                     (parallel, async — sibling shadow roots processed concurrently)
```

---

## 3. injectRules(root, cats, mode)

Builds and injects the `<style id="bl-si-blur-styles">` that drives CSS-based blur.

```
injectRules(root, cats, mode)
        │
        ├─ removeRules(root)  ← always replace, never accumulate
        │
        ├─ [FROSTED mode] ──► ensureSvgFilter(root)
        │                         builds <svg> with feTurbulence + feDisplacementMap + feGaussianBlur
        │                         appended to document.body (or shadow root)
        │
        ├─ build alwaysBlurSelector from active categories
        │    (e.g. "h1,h2,p,img,video,li,dt,dd,[role='button']...")
        │
        ├─ build blurDecl based on mode:
        │    GAUSSIAN  → filter: blur(var(--bl-si-radius, 10px)) !important
        │    FROSTED   → filter: url(#bl-si-frosted-filter) !important
        │    REDACTED  → background-color + color:transparent + filter:none
        │    MASKED    → font-size:0 + filter:none
        │
        ├─ rules built (in order):
        │    1. alwaysBlurSelector EXCLUDE { blurDecl }
        │       (excludes extension UI + [data-bl-si-reveal])
        │    2. [data-bl-si-blur]:not([data-bl-si-reveal]) { blurDecl }
        │    3. [REDACTED/MASKED] media element overrides (visibility:hidden / brightness(0))
        │    4. [data-bl-si-reveal] { filter:none !important; visibility:visible !important }
        │    5. [data-bl-si-reveal][data-bl-si-mask-text]::after { content:none }
        │    6. [data-bl-si-reveal] [data-bl-si-blur] { filter:none }   ← cascade reveal
        │    7. [data-bl-si-reveal] [data-bl-si-pii]  { filter:none }   ← cascade reveal PII
        │
        └─ <style> appended to root.head ?? root
             document → <head>
             ShadowRoot → shadow root itself (no .head)
```

---

## 4. stampElements(root, cats, thorough, mode)

Single `querySelectorAll('*')` pass — stamps text-check elements + discovers shadow roots.

```
querySelectorAll('*') on root
        │
        ├─ for each element:
        │
        │   ├─ [el.shadowRoot] ──► push to shadowRoots[] (caller recurses later)
        │   │
        │   ├─ [tag contains '-'] (custom element host)
        │   │     ├─ [STRUCTURE or TEXT active] + [thorough OR has direct text]
        │   │     └──► dataset.blSiBlur = '1'
        │   │
        │   └─ [tag in _textCheckSet]
        │         ├─ [already stamped] ──► skip
        │         ├─ [is extension UI] ──► skip
        │         │
        │         ├─ [structural tag: div/section/article/...]
        │         │     └─ needsTextGate = true (ALWAYS, even in thorough mode)
        │         │          [hasMeaningfulTextContent] ──► stamp
        │         │
        │         └─ [inline/phrasing: span/a/em/...]
        │               ├─ thorough ──► stamp
        │               ├─ has direct text ──► stamp
        │               └─ has <slot> descendant ──► stamp (shadow DOM projection)
        │
        └─ return shadowRoots[]

Note: alwaysBlur tags (h1/p/img/video/li etc.) handled purely by CSS — no stamping needed.
```

---

## 5. MutationObserver (observeRoot)

Runs continuously while page-blur is active; handles SPAs and dynamic content.

```
DOM mutation: childList on body (or shadow root)
        │
        ├─ [_pickerActive || !_isPageBlurred] ──► ignore
        │
        └─ for each addedNode:
                │
                ├─ tryBlurTextCheck(node, thorough)
                │     └─ same gate as stampElements (text-check tag? → text gate? → stamp)
                │
                ├─ [node.shadowRoot && no existing observer]
                │     └──► handleDocument(_currentSettings, node.shadowRoot)  ← async, fire-and-forget
                │
                └─ recurse into node.querySelectorAll('*')
                        └─ tryBlurTextCheck(child, thorough)
                        └─ [child.shadowRoot] ──► handleDocument(...)
```

---

## 6. teardown(root)

Full disable — removes all blur state from root and descendant shadow roots.

```
teardown(root)
        │
        ├─ disconnectObserver(root)
        ├─ removeRules(root)
        │
        ├─ querySelectorAll('*') — ONE pass
        │     ├─ [blSiBlur && !blSiPii] → delete blSiBlur + mask attrs
        │     └─ [el.shadowRoot] → push to shadowHosts[]
        │
        ├─ remove SVG filter from root if present
        │
        └─ shadowHosts.forEach(h => teardown(h.shadowRoot))
           (sequential, depth-first — parent cleared before children)
```

---

## 7. Item Reconcile (_reconcileItems)

Picker blurs + sticky zones persist independent of blur-all state.

```
_reconcileItems(desired[])
        │
        ├─ build desiredById Map (selector for dynamic, id for sticky)
        │
        ├─ for each _activeItem NOT in desired → removeItem(item)
        │     ├─ dynamic → delete dataset.blSiBlur on element
        │     └─ sticky  → removeZoneOverlay(id)
        │
        └─ for each desired item → applyItem(item)
              ├─ dynamic → SelectorUtils.restoreSelector() → applyBlur(el)
              └─ sticky  → createZoneOverlay({ id, anchor, x, y, width, height })
                               position:fixed (screen) or position:absolute (page)
                               appended to document.body
```

---

## 8. BlurEngine — Two Blur Checks

Two distinct checks exist for different callers:

```
isBlurred(el)                          isVisuallyBlurred(el)
──────────────────────────────         ─────────────────────────────────────────
Used by: picker, toggleBlur,           Used by: reveal_controller ancestor walks
         context-menu unblur

Checks:                                Checks:
 • dataset.blSiBlur                     • dataset.blSiBlur
 • alwaysBlur tag (CSS rule active)     • dataset.blSiPii (PII spans)
                                        • alwaysBlur tag (CSS rule active)
                                        • ARIA role match (roleSet)
                                          e.g. <div role="button"> under FORM

Why separate?
  picker unblur needs isBlurred() to check if a storage item exists.
  Role-matched elements have NO storage item — widening isBlurred() would
  route picker clicks into unblur paths that silently no-op against storage.
```

---

## 9. RevealController — Initialization

```
content_script.js:
  Reveal.init({
    getMode:        () => settings.REVEAL_MODE,   ← function, not value
    isPickerActive: () => isPickerActive,          ← function, not value
  })
        │
        ├─ document.addEventListener('mouseover', onRevealMouseOver, true)   ← capture phase
        ├─ document.addEventListener('mouseout',  onRevealMouseOut,  true)   ← capture phase
        ├─ document.addEventListener('click',     onRevealClick)             ← bubble phase
        └─ document.addEventListener('keydown',   onRevealKeydown)           ← bubble phase

Why capture for mouse?
  SPAs (WhatsApp Web, etc.) call stopPropagation() in their own mouseover
  handlers before bubble reaches document. Capture fires top-down first.

Why bubble for click?
  Capture stopPropagation would kill page click handlers (React, links)
  before they fire — too aggressive.
```

---

## 10. findBlurredTarget — DOM Walk Strategy

The core helper used by both hover and click paths.

```
findBlurredTarget(el, clientX, clientY)
        │
        ├─ Phase 1: Walk UP (light DOM)
        │     node = el → parentElement → ... → documentElement
        │     first isVisuallyBlurred(node) → return node
        │
        ├─ Phase 2: Pierce shadow DOM (if Phase 1 hit null before documentElement)
        │     root = el.getRootNode()
        │     while root is ShadowRoot:
        │       [isVisuallyBlurred(root.host)] → return root.host
        │       lastHost = root.host
        │       root = root.host.getRootNode()
        │     [re-entered light DOM from lastHost]
        │       walk up lightNode.parentElement chain
        │
        └─ Phase 3: Walk DOWN (fallback)
              blurAll active? → ALWAYS_BLUR_SELECTOR + [data-bl-si-blur],[data-bl-si-pii]
              blurAll off?    → [data-bl-si-blur],[data-bl-si-pii]
              el.querySelectorAll(sel) — iterate reverse (innermost first)
              [coords provided] → getBoundingClientRect() hit-test
              [no coords] → return first (innermost) blurred descendant
```

---

## 11. Hover Reveal Flow

```
mouseover (capture) → onRevealMouseOver
        │
        ├─ [mode !== HOVER] ──► return
        ├─ [picker active] ──► (mode check handles it — picker blocks hover reveal indirectly)
        │
        ├─ composedPath()[0] ← pierce shadow DOM retargeting
        │
        ├─ _findZoneAtPoint(clientX, clientY)
        │     zones = Engine.getZoneOverlays()
        │     hit-test via getBoundingClientRect()
        │     [zone hit]
        │       ├─ cancel mouseout timer
        │       ├─ [same zone already revealed] ──► return
        │       ├─ _dismissHoverReveal()
        │       └─ _revealElement(zone) → backdrop-filter: none !important
        │
        └─ findBlurredTarget(target, clientX, clientY)
              [null] ──► return (do NOT clear mouseout timer — debounce handles it)
              [found]
                ├─ cancel mouseout timer
                ├─ [different from _hoverRevealedEl] → _dismissHoverReveal()
                ├─ [same element] ──► return
                └─ _revealElement(blurredRoot) + revealAncestorChain(blurredRoot)

mouseout (capture) → onRevealMouseOut
        │
        └─ [_hoverRevealedEl exists]
               setTimeout(50ms) → _dismissHoverReveal()
               (debounce prevents flicker when cursor crosses element boundaries)
```

---

## 12. Click Reveal Flow

```
click (bubble) → onRevealClick
        │
        ├─ [mode !== CLICK] ──► return
        ├─ [picker active] ──► return
        ├─ [target is input/textarea/select/button/contentEditable] ──► return
        │
        ├─ composedPath()[0] ← pierce shadow DOM
        │
        ├─ _findZoneAtPoint(clientX, clientY)
        │     [zone hit]
        │       ├─ [same zone] ──► return
        │       ├─ dismissClickReveal()
        │       └─ _revealElement(zone) → clickRevealedEl = zone
        │          + preventDefault() + stopPropagation()
        │
        └─ findBlurredTarget(target, clientX, clientY)
              [null] ──► return (no reveal)
              [same as clickRevealedEl] ──► return
              [different]
                ├─ dismissClickReveal()      ← clear previous
                ├─ _revealElement(blurredEl)
                ├─ clickRevealedEl = blurredEl
                ├─ revealAncestorChain(blurredEl)
                └─ preventDefault() + stopPropagation()

keydown → onRevealKeydown
  [Escape + clickRevealedEl] ──► dismissClickReveal()
```

---

## 13. _revealElement — What Actually Happens

```
_revealElement(el)
        │
        ├─ [is zone overlay]
        │     el.style.setProperty('backdrop-filter', 'none', 'important')
        │     el.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
        │
        └─ [regular element]
              el.dataset.blSiReveal = '1'
              │
              ├─ querySelectorAll(alwaysBlurSelector + [data-bl-si-blur] + [data-bl-si-pii])
              └─ for each blurred child:
                    child.dataset.blSiReveal = '1'
                    _revealedElements.add(child)
              _revealedElements.add(el)

CSS effect (content.css + injected <style>):
  [data-bl-si-reveal] {
    filter: none !important;          ← clears gaussian / frosted
    visibility: visible !important;   ← restores hidden media in redacted mode
    user-select: auto !important;
  }
  [data-bl-si-reveal] [data-bl-si-blur] { filter: none !important }
  [data-bl-si-reveal] [data-bl-si-pii]  { filter: none !important }
  (cascade rule clears blurred islands inside a revealed ancestor)
```

---

## 14. revealAncestorChain

Prevents blurred parent from compositing the whole subtree (CSS filter: blur on parent ignores child filter: none).

```
revealAncestorChain(el)
        │
        ├─ clearRevealedAncestors()  ← clear previous ancestor stamps
        │
        └─ walk el.parentElement → ... → documentElement
              [isVisuallyBlurred(node)]
                node.dataset.blSiReveal = '1'
                revealedAncestors.push(node)

Why needed?
  If <p data-bl-si-blur> contains <span data-bl-si-blur>, revealing <span>
  sets filter:none on span — but parent <p>'s filter:blur still applies to
  the whole subtree (CSS filter composites all descendants). Stamping the
  parent with blSiReveal clears its filter too, letting the span show through.
```

---

## 15. Engine ↔ Reveal Interaction Map

```
blur_engine.js                          reveal_controller.js
──────────────────────────────          ──────────────────────────────────────
injectRules()                    ──►    [data-bl-si-reveal] CSS rule (included
  builds [data-bl-si-reveal]             in injected <style>) overrides blur
  override rules in <style>

isVisuallyBlurred(el)            ◄──    _isVisuallyBlurred() delegates here
  (checks blur + PII + roles)           used in: findBlurredTarget,
                                         revealAncestorChain, _revealElement

getZoneOverlays()                ◄──    _findZoneAtPoint() gets all overlays
                                         for hit-testing

isBlurAllActive()                ◄──    findBlurredTarget: decides which CSS
                                         selector to use for DOWN walk

CATEGORY_SELECTORS               ◄──    ALWAYS_BLUR_SELECTOR built once at
  (all alwaysBlur tags across all        module load from Engine.CATEGORY_SELECTORS
   categories)

_isPageBlurred (getter)                 (not used by reveal directly;
_currentSettings                         only engine reads these)
_observers (WeakMap)
```

---

## 16. Full Page Load Sequence

```
page loads
    │
    └─ content_script init()
            │
            ├─ Reveal.init({ getMode, isPickerActive })
            │     attach 4 document listeners
            │
            ├─ Storage.getSettings() + getBlurState() + getBlurItems() + getRules()
            │
            └─ _reconcile()
                    │
                    └─ Engine.handleSite({
                          ...settings,
                          BLUR_ALL_ACTIVE: blurState[hostname],
                          BLUR_ITEMS: blurItems[hostname],
                       })
                              │
                              ├─ handleDocument(settings, document)
                              │     ├─ injectRules(document.head)
                              │     ├─ clear old stamps
                              │     ├─ stampElements() → shadowRoots[]
                              │     ├─ observeRoot(document)
                              │     └─ Promise.all(shadowRoots.map(handleDocument))
                              │
                              └─ _reconcileItems(BLUR_ITEMS)
                                    ├─ dynamic → restoreSelector → applyBlur
                                    └─ sticky  → createZoneOverlay
```

---

## 17. Settings Change / SPA Navigation Sequence

```
settings change (popup UPDATE_SETTINGS)
or SPA URL change (onUrlChange)
    │
    └─ applyState(newSettings)
            │
            └─ _reconcile()
                    │
                    └─ Engine.handleSite(settings)
                              │
                              ├─ [reconcileKey same] ──► SKIP handleDocument
                              │   CSS vars (--bl-si-radius, --bl-si-highlight-color)
                              │   already set by applySettingsToDom() — propagates instantly
                              │
                              └─ [key changed] ──► await handleDocument(settings, document)
                                    injectRules → new <style> replaces old one
                                    stampElements → re-scan with new categories/mode
```

---

## Summary: Two Systems, One Rule Set

| Concern | Owner |
|---|---|
| CSS rules for blur (always-blur tags) | `blur_engine.injectRules` |
| Stamp data-bl-si-blur on text-check elements | `blur_engine.stampElements` + `tryBlurTextCheck` |
| Zone overlays (sticky zones) | `blur_engine.createZoneOverlay` |
| MutationObserver for SPA dynamic content | `blur_engine.observeRoot` |
| Shadow DOM recursion | `blur_engine.handleDocument` (parallel) |
| Reveal override CSS rules | `blur_engine.injectRules` (rules 4–7 above) |
| Detecting blurred elements for reveal | `blur_engine.isVisuallyBlurred` |
| Hover reveal event handling + debounce | `reveal_controller.onRevealMouseOver/Out` |
| Click reveal event handling | `reveal_controller.onRevealClick` |
| Ancestor chain unblur | `reveal_controller.revealAncestorChain` |
| Shadow DOM pierce for events | `reveal_controller.findBlurredTarget` (composedPath + host walk) |
| Zone overlay reveal (backdrop-filter) | `reveal_controller._revealElement` |
