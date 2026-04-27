# Engine split — file-by-file review

Cross-checking each module's code against its contract (`docs/contracts/{,core/}*.md`) and its actual call sites. 792 unit tests stay green; this doc lists issues I found that didn't justify changes during the cleanup pass — mix of real bugs, smells, perf concerns, and stale docs. Each item is independent.

Severity legend: **B**ug · **S**mell / tech debt · **P**erf · **D**oc drift · **N**it.

---

## 1. `src/core/engine_state.js` (51 lines)

| # | Sev | Finding |
|---|---|---|
| 1.1 | **S** | Setter coercion is inconsistent. `setIsPageBlurred` / `setPickerActive` / `setPickBlurDynamicActive` coerce `v` to boolean (`!!v`); `setCurrentSettings(v)` stores whatever is passed. A caller passing `undefined` would replace the stored `null` with `undefined`. Readers gate on `if (!settings)` so behaviour is harmless, but the setter contract is asymmetric — either coerce all or none. |
| 1.2 | **N** | `decrementBlurredCount` allows negative values. Caller (`MarkerEngine.removeBlur`) gates on the data attribute being present, but a future caller could double-decrement. The contract notes this; a clamping setter would prevent the foot-gun without API changes. |
| 1.3 | **N** | No test-only `_reset()` helper after cleanup. Tests today use DOM cleanup + `unblurAll()`, but a future per-sub-module test for `engine_state.js` itself will need to seed/clear state without DOM. Re-add only when a test requires it. |

---

## 2. `src/core/categories.js` (145 lines)

| # | Sev | Finding |
|---|---|---|
| 2.1 | **S** | `DEFAULT_CATS` is a *reference* to `blsi.DEFAULT_MODEL.blur_all.settings.blur_categories`, not a clone. Any mutation propagates to every consumer. Documented but not enforced. Could `Object.freeze(DEFAULT_CATS)` defensively, or clone. |
| 2.2 | **N** | `CATEGORY_ORDER` and `CATEGORY_SELECTORS` are independent. Adding a category to one without the other silently breaks `buildSelectors` (the new key is ignored). No drift assertion. A test like `expect(CATEGORY_ORDER.sort()).toEqual(Object.keys(CATEGORY_SELECTORS).sort())` would catch this. |

---

## 3. `src/core/css_manager.js` (466 lines, largest module)

| # | Sev | Finding |
|---|---|---|
| 3.1 | **B** | Line 264: `mediaTags.split(",").filter(t => alwaysBlurSelector.includes(t))` uses *string-substring* matching, not exact tag match. Currently safe because no media tag is a substring of another (`img`, `video`, `audio`, `canvas`, `svg`, `picture`). Adding a tag like `vid` or `audi` would silently false-match. Use `Set.has` against the cache's `alwaysBlurTags` array instead. |
| 3.2 | **S** | Line 100–105: `_readCssRadius` returns `null` when the CSS var is `0px` (because `n > 0` is false). Caller does `_readCssRadius() \|\| 4`, so a user who sets radius to 0 gets 4 instead. Intent unclear — if 0 means "no blur" it should be honoured; if 0 is invalid it should be rejected explicitly. |
| 3.3 | **S** | Line 235: `if (isMasked && blsi.Fonts) rules.push(blsi.Fonts.DISC_FONT_FACE);` — the `&& blsi.Fonts` guard is leftover defensive code. `fonts.js` loads before `css_manager.js` per manifest. Either drop the guard (consistent with the cleanup pass) or document why it stays. Same applies to line 427 for `ASTERISK_FONT_FACE`. |
| 3.4 | **S** | `injectRules` is 121 lines and braids three mode branches with reveal overrides + media-tag rules. Could split into `_buildBlurDecl(mode, isRedacted, isMasked)` + `_buildMediaRules(...)` + `_buildRevealOverrides()`. Improves readability without changing behaviour. |
| 3.5 | **N** | `_colorToRgba` uses underscore prefix (private convention) but reads like a utility. Naming suggests it's used outside this section even though it's only called from `injectPickBlurRules`. Consistent with the rest of the codebase, just noting. |
| 3.6 | **D** | Contract `css_manager.md` says "Memoised by category fingerprint; rebuilds on key miss via internal `buildSelectors`" — accurate, but the internal `buildSelectors` is not exposed for tests, while the .tests.md still lists `buildSelectors` as a module-level helper to test. Align the .tests.md with the dropped public export. |

---

## 4. `src/core/marker_engine.js` (303 lines)

| # | Sev | Finding |
|---|---|---|
| 4.1 | **S** | `stampElements(root, categories, thorough, mode)` — the `mode` parameter is unused inside the function body. Pre-existing dead parameter. Test signatures use it. Drop with care, or document why it stays in the signature. |
| 4.2 | **S** | `applyBlur(element)` (line 184) doesn't check `data-bl-si-pick-blur` or `data-bl-si-pii`. If picker stamps an element that already carries one of those, both attributes co-exist. CSS owns specificity (pick-blur / PII win via the EXCLUDE chain on the blur-all selector), so visually it works — but `blurredCount` increments without a corresponding visual blur change. Symmetric on the remove side: `removeBlur` clears both `data-bl-si-blur` and `data-bl-si-pick-blur` but only decrements when the former was present. The semantic is "count tracks `data-bl-si-blur` only" — consistent — but a stricter pre-check would tighten ownership. |
| 4.3 | **D** | The "Reveal-only helper" docstring (line 213) is verbose and explains the picker / context-menu rationale at length. Useful context but better in the contract — the body of `isVisuallyBlurred` is 16 lines and the comment is 14 lines. Trim the source comment, leave the deep rationale in `marker_engine.md`. |
| 4.4 | **N** | `_isExtensionUI` does up to 6 DOM lookups per call (`closest` × 2, `classList.contains` × 2, dataset, id). Called once per stamped element in `stampElements` (which does `querySelectorAll('*')`). On a 10k-element page, 60k lookups before any blur stamps land. Pre-existing. Could short-circuit on the cheapest checks first. |

---

## 5. `src/core/observer.js` (327 lines)

| # | Sev | Finding |
|---|---|---|
| 5.1 | **B** | Line 154: `const { root, cats, thorough, mode, settings } = _stampQueue.shift();` — `settings` is destructured but never used in `_flushStampQueue`. The push at line 164 also includes `settings` so the queue item shape carries an unused field. Dead destructuring + dead field. Drop from queue items and the destructure. |
| 5.2 | **P** | Line 87–89: ancestor-coverage filter is O(n²) — for each pending node, scans every other pending node calling `.contains()`. On a SPA dropping 1000 nodes per MO tick (rare but real for virtualised lists), that's ~500k `contains` calls on the idle path. Could be O(n) by sorting by depth or using a Set of seen ancestors. |
| 5.3 | **S** | The `MO callback` and `_drainMoIdle` together implement two independent buffers (`_pendingMoNodes` for engine, `_pendingMutations` per root for subscribers) with different gates. The branching at lines 195–227 is tight but easy to mis-modify. A short comment summarising the truth table (engine gate × subscriber gate × engineCollected) above the function would prevent regressions. |
| 5.4 | **B** | `subscribeMutations` registered AFTER an MO event has already buffered records loses those records — `_pendingMutations` is cleared at idle time regardless of subscriber count. PII detector subscribes early via `content_script.applyState`, so this is theoretical, but a future late-registration subscriber would silently miss data. Either document this race in the contract or buffer-on-first-subscriber-only. |
| 5.5 | **D** | `observer.md` line 26 still says `blsi.TargetEngine.tryPickBlurNode (when present)` — the `when present` qualifier was for the transitional period when target_engine wasn't loaded yet. Now manifest order guarantees it; drop the qualifier. |
| 5.6 | **N** | `scheduleStampIdle: _scheduleStampIdle` in the public return (line 323) — the only caller (`engine.js handleMainDocument`) could call `_scheduleStampIdle` directly if it were renamed. Cosmetic. |

---

## 6. `src/core/target_engine.js` (337 lines)

| # | Sev | Finding |
|---|---|---|
| 6.1 | **P** | `tryPickBlurNode` (line 132) is called once per node in the MO drain. For each node, it iterates *every* active item, *every* selector per item, calls `el.matches(sel)` AND `document.querySelectorAll(sel).length === 1`. Worst case: nodes × items × selectors × O(document) per `querySelectorAll`. With 5 dynamic items × 6 selectors × 100 nodes = 3000 querySelectorAll calls per drain on a SPA-heavy page. The uniqueness check could be precomputed per item (run once after reconcile) and cached. |
| 6.2 | **S** | `_applyStickyItem` (line 155–203) interleaves three concerns: coordinate calculation, overlay creation, and counter seeding. The counter-seeding block at line 192–202 parses item names back to integers — fragile if a future naming convention changes. Extract counter-seed-from-name into a helper next to `allocateElementName` / `allocateStickyName` so it's adjacent to the format that produces the names. |
| 6.3 | **S** | Line 169: `const wChanged = item.scrollWidth && Math.abs(curW - item.scrollWidth) > Math.max(10, item.scrollWidth * 0.01);` — falsy-zero short-circuit. If `item.scrollWidth === 0` (saved on a 0-width window or missing field), `wChanged = false` and re-projection is skipped. Reasonable fallback but worth an explicit comment. |
| 6.4 | **N** | `_isExtensionUI(el)` (line 117) wraps `blsi.MarkerEngine._isExtensionUI` in a one-liner. Manifest order guarantees `MarkerEngine` is loaded — could collapse to `const _isExtensionUI = blsi.MarkerEngine._isExtensionUI;` at the top of the IIFE. Saves a stack frame per call. |
| 6.5 | **B** | Line 122–125: `_applyDynamicItem` doesn't check `data-bl-si-pii`. If a dynamic-item selector matches a PII-stamped span, the picker stamp lands on it. Then the EXCLUDE chain on the always-blur CSS rule excludes it (via `:not([data-bl-si-pii])`), but the static `[data-bl-si-pick-blur]` rule in `content.css` still matches. Result: PII span gets pick-blur styling on top of PII styling. Pre-existing edge case; document as known limitation or guard. |
| 6.6 | **D** | `target_engine.md` "Edge cases" section mentions counter seeding and selector failures but not the picker-stamping-PII case (6.5) or the position-fixed-under-transformed-ancestor zone misalignment (already in `CLAUDE.md` Known Limitations). Cross-link the global limitations from the module contract. |

---

## 7. `src/engine.js` (379 lines, facade + orchestrator)

| # | Sev | Finding |
|---|---|---|
| 7.1 | **S** | `handleMainDocument` (line 156) and `handleShadowRoot` (line 186) share ~80% structure: read cats/mode/thorough from settings, `injectRules`, `observeRoot`, push to stamp queue, schedule idle. Differ only in the shadow-attach-listener init (main only) and the queue replacement vs append. Extract `_dispatchToRoot(root, settings, opts)` with `opts: { initShadowListener, replaceQueue }`. Cuts ~25 lines. |
| 7.2 | **S** | `handleSite` (line 235) is 70 lines and braids: mutex acquisition, CSS vars, extension-disabled path, reconcile-key fingerprint, page-wide reconcile, item reconcile, MO re-attach, pick-blur CSS, logger flow. Could split into clearly-named helpers (`_reconcilePageWide`, `_reconcileItemsAndPickBlur`) for readability. |
| 7.3 | **B** | Line 285: `if (_State.getPickBlurDynamicActive()) observeRoot(document);` — re-attaches observer when pick-blur dynamic is active. But if `pageWideChanged === true` AND blur-all is also active, `handleMainDocument` already attached the observer. Then this redundantly calls observeRoot (idempotent — no harm but wasteful). A `if (!isActive && _State.getPickBlurDynamicActive())` would skip the redundant call. |
| 7.4 | **S** | `_lastReconcileKey` fingerprint (line 266) builds a string per call. Hot path; `String.prototype.split('|')`-style fingerprints are cheap but allocate a new String each call. Could memoise the category-fingerprint sub-string per `cats` reference — the categories object is a frozen reference and stable across many calls. |
| 7.5 | **S** | The aliasing block (lines 30–72) imports 22 names from sub-modules, but only ~13 are used in the body (the rest are pure re-exports for the public API). The cleanup pass dropped 3 dead aliases; the remaining "alias just to re-export" pattern adds vertical space without value. Alternative: `return { ...Css.publicApi, ...Marker.publicApi, ...Targets.publicApi, /* orchestration */ }` if each module exposed a `publicApi` block. Bigger refactor; flagging only. |
| 7.6 | **D** | Line 312 comment in the public API block says "update CLAUDE.md Module Globals table + docs/contracts/engine.md" — accurate. But the comment also says "do NOT call from content_script, popup, picker, or reveal — use handleSite()" referring only to the semi-private re-exports (`injectRules`, etc). The entire public block re-exports things the picker DOES call directly (`applyBlur`, `removeBlur`, `isBlurred`). Comment is misleading — should say the *first* group is test-only, not the whole block. |
| 7.7 | **S** | `_applyCssVars` (line 90) sets four properties unconditionally. If `settings.highlight_color` is undefined (early init), `setProperty('--bl-si-highlight-color', undefined)` writes the literal string `"undefined"`. Reasonable defaults exist via content.css fallbacks but the var still gets a junk value. Guard each `setProperty` on the source field being present. |
| 7.8 | **B** | Static iframes at initial page load are NOT covered by CSS blur rules (no `iframe` in `Categories.media.alwaysBlur`) and `stampElements` doesn't stamp iframes (no `<iframe>` in `_textCheckSet`). They'd only be stamped via `handleIframe` which fires from the MO drain on insert. Initial iframes present at page load are missed entirely — pre-existing gap, not introduced by the refactor. Document as known limitation or extend stampElements with an iframe pass. |
| 7.9 | **S** | Line 169 `Obs.initShadowAttachListener();` is called every time `handleMainDocument` runs the active path. The function is idempotent so no harm, but cleaner to call once on first activation and never again. |

---

## Cross-module / system-level findings

| # | Sev | Finding |
|---|---|---|
| X.1 | **S** | The `Marker → CssManager` dependency is bidirectional at runtime: `CssManager.injectRules` calls `MarkerEngine.rebuildTextCheckSet`; `MarkerEngine.{isBlurred,isVisuallyBlurred,matchesActiveCategories}` call into `CssManager`. No cycle at IIFE init (calls are runtime-resolved), but the conceptual coupling is high. A future split would benefit from a single "category-derived data" module that both consume. |
| X.2 | **S** | Subscriber dispatch ordering is documented (engine drain first, then subscribers). PII detector relies on this — text nodes inserted into a dynamically-added container get wrapped with `data-bl-si-pii` AFTER the container is stamped with `data-bl-si-blur`. Result: the inner span has both the parent's blur-all filter AND its own PII filter cascading. Visually fine because both produce blur, but redundant work. Out of scope to fix here. |
| X.3 | **D** | `engine.tests.md` documents that the test split is deferred. Several sub-module `*.tests.md` describe per-module test groups that don't exist as separate files yet. Either complete the split or rename the contracts to "future test layout". |
| X.4 | **D** | `docs/contracts/core/engine_state.tests.md` references `_reset()` removed earlier. Already updated, but verify contract matches code. |
| X.5 | **N** | Naming: `MarkerEngine` and `TargetEngine` end in "Engine" while the orchestrator is also named "Engine". Three "engines" in the namespace. User chose this; flagging because cold readers will conflate them. |
| X.6 | **B** | `blsi.Engine.unblurAll()` calls `removeAllZoneOverlays()` AFTER `teardown(document)`. Teardown clears `data-bl-si-pick-blur` on every element including zone overlay divs; then `removeAllZoneOverlays` removes the divs from DOM. Net effect identical to before the split. But a caller calling `Engine.teardown(document)` directly (test path) leaves orphan zone overlays in the DOM with their pick-blur attribute already cleared — half-blurred zones. Document or add a teardown-document zones cleanup. |

---

## What did NOT come out of this review

- No regressions vs. the pre-split baseline. Every "B" entry above is either pre-existing (3.1, 6.5, 7.8, X.6) or a leftover artifact from the refactor that doesn't affect runtime correctness today (5.1).
- No coverage drops. The refactored code has equal or higher per-module coverage than the original monolith (engine_state.js 72% is the only outlier — see CLEANUP-CANDIDATES.md item 2).
- No Manifest-order regressions. Every cross-module call resolves at runtime by which point all modules are loaded.

---

## Suggested next-pass priorities

If a follow-up cleanup PR is approved (per `CLEANUP-CANDIDATES.md`):

1. **5.1** dead `settings` field in stamp queue items — trivial drop, removes a confusing data shape.
2. **3.1** brittle `alwaysBlurSelector.includes(t)` substring match — replace with set lookup, prevents future false positive.
3. **7.6** misleading comment in the public API block — one-line fix.
4. **7.7** `setProperty('--bl-si-highlight-color', undefined)` writing junk — guard each setProperty.
5. **5.5** stale `(when present)` qualifier in observer.md — one word change.

After those: tackle the perf items (5.2, 6.1) only if they show up in profiling, and the structural refactors (7.1, 7.2, 3.4) only if the file-size targets in the original plan matter (css_manager.js is 466 lines, over the 350 target).

---

## Status — fixes landed (review pass 2)

User triaged the findings and asked to fix every non-perf item that affects real-life use.

| # | Status | Notes |
|---|---|---|
| 3.1 substring match | **Fixed** | `mediaTags` now an array; exact-match against `Set(cache.alwaysBlurTags)` |
| 3.2 `_readCssRadius` rejecting 0 | **Fixed** | `n >= 0` accepts 0; caller distinguishes `null` (missing) from 0 (no blur) |
| 3.3 `blsi.Fonts &&` defensive guards | **Fixed** | Guards dropped; tests updated to load `fonts.js` |
| 5.1 dead `settings` in stamp queue | **Fixed** | Field removed from queue shape and destructure in observer.js |
| 5.5 stale `(when present)` qualifier | **Fixed** | Dropped from `observer.js` header docstring |
| 6.6 missing limitations link | **Fixed** | Picker-on-PII and transformed-ancestor edge cases now in `target_engine.md` Edge cases |
| 7.6 misleading public API comment | **Fixed** | Comment now scopes the test-only block explicitly |
| 7.7 `setProperty(name, undefined)` writing `"undefined"` | **Fixed** | Each `setProperty` gated on field being non-null |
| 7.8 initial iframes not blurred | **Fixed (real bug)** | `stampElements` now stamps cross-origin iframes via the same logic as `handleIframe`; same-origin iframes still skipped (their own content_script handles them) |
| 1.1 / 1.2 / 1.3 / 2.1 / 2.2 / 4.1 / 4.2 / 4.3 / 5.4 / 6.5 / 7.3 / 7.5 / X.6 | Skipped | No real-life impact today (theoretical, test-only paths, or readability) |
| 4.4 / 5.2 / 6.1 / 7.4 | Skipped | Performance — user instruction to defer until profiling flags them |
| 7.1 / 7.2 / 3.4 / 6.2 / 6.3 / 6.4 / 5.3 / 5.6 | Skipped | Structural / readability — out of scope |

All 792 unit tests green after the fixes. The iframe-stamping change (7.8) extends `stampElements` with a same-origin probe (`iframeEl.contentDocument` access in a try/catch). It mirrors the existing `handleIframe` logic exactly so the active-side semantics are identical regardless of whether the iframe was present at page load (caught by stampElements) or inserted later (caught by MO + handleIframe).
