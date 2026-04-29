/**
 * core/marker_engine.js — element-level blur stamping + match queries.
 *
 * Owns every operation that toggles `data-bl-si-blur` on an individual
 * Element: the page-wide stamp pass, the MO-fed single-node check, the
 * picker apply/remove paths, and the predicates picker / reveal_controller
 * use to decide whether an element is currently blurred.
 *
 * Cross-module reads:
 *   - blsi.Categories.{CATEGORY_SELECTORS, DEFAULT_CATS}
 *   - blsi.CssManager.{getSelectors, getLastSelectorCache, isBlurAllActive}
 * Cross-module writes:
 *   - blsi.EngineState.{incrementBlurredCount, decrementBlurredCount}
 *
 * Inbound calls:
 *   - observer.js MO callback → MarkerEngine.tryBlurTextCheck, stampElements
 *   - target_engine.js → MarkerEngine._isExtensionUI (gates pick-blur stamps)
 *   - picker.js (via Engine facade) → applyBlur, removeBlur, isBlurred
 *   - reveal_controller.js (via Engine facade) → isVisuallyBlurred
 *
 * Text-check tag set: read from the shared CssManager.getSelectors(cats)
 * cache (`textCheckSet` field). No parallel cache lives here.
 *
 * Exposed as blsi.MarkerEngine (IIFE — no ES module syntax).
 */

const BlurrySiteMarkerEngine = (() => {
  'use strict';

  const Cats = blsi.Categories;
  const Css  = blsi.CssManager;
  const State = blsi.EngineState;

  const CATEGORY_SELECTORS = Cats.CATEGORY_SELECTORS;
  const DEFAULT_CATS       = Cats.DEFAULT_CATS;

  /**
   * Structural container tags — wrappers that group content but rarely hold
   * private text directly. Blurring these creates redundant nested blur that
   * breaks hover reveal (CSS filter on a parent composites the entire subtree,
   * so unblurring a parent leaks all siblings). These always require the
   * hasMeaningfulTextContent gate, even in thorough mode.
   */
  const _structuralTags = new Set(CATEGORY_SELECTORS.structure.textCheck);

  function hasMeaningfulTextContent(element) {
    for (const node of element.childNodes) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.textContent.trim().length > 0
      ) {
        return true;
      }
    }
    return false;
  }

  function _isExtensionUI(element) {
    const toolbarId = blsi.ids.picker_toolbar;
    return (
      element.id === toolbarId ||
      element.closest("#" + toolbarId) ||
      element.classList.contains(blsi.css.toast) ||
      element.closest("." + blsi.css.toast) ||
      element.classList.contains(blsi.css.toolbar) ||
      // Body-level picker surfaces — siblings of the toolbar, not descendants.
      element.classList.contains('bl-si-toolbar-tooltip') ||
      element.classList.contains('bl-si-zone-drawing') ||
      element.dataset.blSiZone !== undefined ||
      // Zone descendants (e.g. .bl-si-zone-label) inherit nothing from the
      // overlay's data-bl-si-zone attribute; cover the whole subtree.
      element.closest('[data-bl-si-zone]')
    );
  }

  // ── Cross-origin <iframe> stamp ────────────────────────────────────────────
  // Single source of truth for the cross-origin probe + stamp/unstamp logic.
  // Used by stampElements (initial idle pass — `active=true` always) and by
  // engine.handleIframe (orchestrator — passes whatever the resolved settings
  // says). Same-origin iframes self-handle via `all_frames: true` and are
  // skipped here.
  function _stampIframeIfCrossOrigin(el, active) {
    if (!el || _isExtensionUI(el)) return;
    let isSameOrigin = false;
    try { isSameOrigin = !!el.contentDocument; } catch (_) { /* cross-origin */ }
    if (isSameOrigin) return;
    if (active) {
      if (!el.dataset.blSiBlur) { el.dataset.blSiBlur = '1'; State.incrementBlurredCount(); }
    } else {
      if (el.dataset.blSiBlur) { delete el.dataset.blSiBlur; State.decrementBlurredCount(); }
    }
  }

  // ── Text-check element blur (scan + MO for new nodes) ─────────────────────

  /**
   * Single source of truth for per-element stamping decisions. Called by
   * stampElements (full-document forEach) and tryBlurTextCheck (MO drain).
   * Mutates `el.dataset.blSiBlur` and increments the engine count on stamp.
   *
   * Branches in order:
   *   1. Competing-blur ownership guard (data-bl-si-blur / pick-blur / pii)
   *   2. Extension UI guard
   *   3. Custom-element host (tag.includes('-')) — gated on STRUCTURE|TEXT
   *      active and (thorough || hasMeaningfulTextContent), return
   *   4. Text-check tag — structural gate vs. inline-with-slot fallback
   *
   * <iframe> is intentionally NOT handled here: stampElements has an inline
   * iframe branch (full-pass only) and observer.js MO drain calls
   * Engine.handleIframe directly for newly-inserted IFRAMEs. Routing iframes
   * through this helper would double-process them in the MO path.
   *
   * `textCheckSet` is the active text-check tag Set from
   * CssManager.getSelectors(cats).textCheckSet. Callers fetch it once outside
   * the per-element loop and pass it in to avoid repeated cache lookups.
   */
  function _evaluateAndStamp(el, cats, thorough, textCheckSet) {
    if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;
    if (_isExtensionUI(el)) return;
    const tag = el.tagName.toLowerCase();

    if (tag.includes('-')) {
      if ((cats.structure !== false || cats.text !== false) &&
          (thorough || hasMeaningfulTextContent(el))) {
        el.dataset.blSiBlur = '1';
        State.incrementBlurredCount();
      }
      return;
    }

    if (!textCheckSet.has(tag)) return;
    // Structural containers (div, section, etc.) always require the text gate —
    // blurring wrappers creates nested blur that breaks hover reveal. Thorough
    // mode only bypasses the gate for inline content elements.
    const needsTextGate = _structuralTags.has(tag);
    let shouldStamp;
    if (needsTextGate) {
      shouldStamp = hasMeaningfulTextContent(el);
    } else {
      // For inline/phrasing content (a, span, em, etc.): also stamp if the
      // element contains a <slot> descendant — shadow DOM projection means the
      // slot renders light-DOM content visually (text, images) even though the
      // host has no direct text nodes. CSS filter on the stamped element blurs
      // the projected slot content correctly.
      shouldStamp = thorough || hasMeaningfulTextContent(el) ||
        !!(el.querySelector && el.querySelector('slot'));
    }
    if (shouldStamp) {
      el.dataset.blSiBlur = '1';
      State.incrementBlurredCount();
    }
  }

  /**
   * Scan elements in `root`, stamp `data-bl-si-blur` on text-check elements
   * matching the active categories, and collect any open shadow roots found
   * during the traversal — all in ONE querySelectorAll('*') pass.
   *
   * Returns the discovered ShadowRoot[] so the caller (_flushStampQueue) can
   * dispatch into them after this root is fully processed. No shadowCb param —
   * the caller owns dispatch so shadow roots are never processed mid-loop.
   */
  function stampElements(root, categories, thorough) {
    const cats = categories || DEFAULT_CATS;
    // Snapshot the shared selector cache once — textCheckSet is keyed on cats
    // so we avoid the per-element lookup. Cache also drives marker_engine's
    // role/tag predicates elsewhere via getLastSelectorCache.
    const textCheckSet = Css.getSelectors(cats).textCheckSet;

    // Collect shadow roots piggybacked on the stamp pass — no extra traversal.
    const shadowRoots = [];

    root.querySelectorAll('*').forEach((el) => {
      // Inline stale-clear — avoids a separate querySelectorAll('[data-bl-si-blur]')
      // pre-pass. PII-stamped elements keep their stamp (they own their blur lifecycle).
      // Only the full-document re-pass owns this teardown — the MO drain
      // (tryBlurTextCheck) sees only newly-added nodes that have no prior stamp.
      if (el.dataset.blSiBlur && !el.dataset.blSiPii) { delete el.dataset.blSiBlur; State.decrementBlurredCount(); }

      // Shadow root discovery: collect for post-stamp dispatch by caller.
      // CSS injected into each shadow root handles alwaysBlur declaratively;
      // text-check stamping happens when caller recurses via _flushStampQueue.
      if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

      const tag = el.tagName.toLowerCase();

      // Cross-origin iframe — stamp as a black-box. Same-origin iframes
      // self-handle via all_frames:true (they get their own content_script)
      // so we skip them. The MO drain reaches dynamically-inserted iframes
      // through facade.handleIframe; this branch covers iframes present at
      // full-pass time.
      if (tag === 'iframe') {
        _stampIframeIfCrossOrigin(el, true);
        return;
      }

      _evaluateAndStamp(el, cats, thorough, textCheckSet);
    });

    return shadowRoots;
  }

  /**
   * Check if a single dynamically-added element should be blurred and stamp
   * it. Called by the MutationObserver drain in observer.js for every node
   * added in a childList mutation and each of its descendants.
   *
   * Categories and thorough mode are read from EngineState.getCurrentSettings()
   * (orchestrator-set during handleSite). Falls back to DEFAULT_CATS if no
   * settings are seeded yet (defensive — should not normally happen).
   */
  function tryBlurTextCheck(element, thorough) {
    if (!element || !(element instanceof Element)) return;
    const cs = State.getCurrentSettings();
    const cats = (cs && cs.blur_categories) || DEFAULT_CATS;
    const textCheckSet = Css.getSelectors(cats).textCheckSet;
    _evaluateAndStamp(element, cats, thorough, textCheckSet);
  }

  // ── Individual element blur (picker / context menu) ────────────────────────

  function applyBlur(element) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur) return;
    if (_isExtensionUI(element)) return;
    element.dataset.blSiBlur = "1";
    State.incrementBlurredCount();
  }

  function removeBlur(element) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur) State.decrementBlurredCount();
    delete element.dataset.blSiBlur;
    delete element.dataset.blSiPickBlur;
  }

  function isBlurred(element) {
    if (!element || !(element instanceof Element)) return false;
    if (element.dataset.blSiBlur || element.dataset.blSiPickBlur) return true;
    const cache = Css.getLastSelectorCache();
    if (Css.isBlurAllActive() && cache) {
      const tag = element.tagName.toLowerCase();
      // Only always-blur tags are covered by CSS. Text-check tags need data attr.
      for (let i = 0; i < cache.alwaysBlurTags.length; i++) {
        if (cache.alwaysBlurTags[i] === tag) return true;
      }
    }
    return false;
  }

  /**
   * Reveal-only helper: returns true for everything `isBlurred` returns true
   * for, PLUS elements blurred via the role-based CSS selectors of an active
   * blur-all category (e.g. `<button role="tab">` under FORM). reveal_controller
   * uses this on its ancestor / descendant walks so a role-matched parent's
   * filter gets cleared during hover or click reveal — without it, the inner
   * picker reveal succeeds but the parent's CSS filter still applies blur to
   * the same subtree, producing a "dual blur / no reveal" effect.
   *
   * Kept separate from `isBlurred` because `isBlurred` is also used by picker
   * and context-menu unblur paths to decide whether a stored item exists for
   * a clicked element. Role-matched elements have NO stored item (they are
   * blurred by CSS rule alone), so widening `isBlurred` would route those
   * clicks through unblur paths that silently no-op against storage.
   */
  function isVisuallyBlurred(element) {
    if (!element || !(element instanceof Element)) return false;
    if (element.dataset.blSiBlur || element.dataset.blSiPickBlur) return true;
    if (element.dataset.blSiPii) return true;  // PII spans have their own CSS rule
    const cache = Css.getLastSelectorCache();
    if (Css.isBlurAllActive() && cache) {
      const tag = element.tagName.toLowerCase();
      for (let i = 0; i < cache.alwaysBlurTags.length; i++) {
        if (cache.alwaysBlurTags[i] === tag) return true;
      }
      if (cache.roleSet && cache.roleSet.size > 0) {
        const role = element.getAttribute("role");
        if (role != null && cache.roleSet.has(role)) return true;
      }
    }
    return false;
  }

  function matchesActiveCategories(element, categories) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const { tagSet, roleSet } = Css.getSelectors(cats);
    if (tagSet.has(element.tagName.toLowerCase())) return true;
    if (roleSet.size === 0) return false;
    const role = element.getAttribute("role");
    return role != null && roleSet.has(role);
  }

  return {
    // Element-level apply/remove (picker / context menu).
    applyBlur,
    removeBlur,

    // Match queries.
    isBlurred,
    isVisuallyBlurred,
    matchesActiveCategories,

    // Page-wide + single-node stamp paths.
    stampElements,
    tryBlurTextCheck,

    // Cross-origin iframe stamp/unstamp — used by engine.handleIframe.
    _stampIframeIfCrossOrigin,

    // Utility — exported for target_engine to gate pick-blur stamps.
    _isExtensionUI,
  };
})();

blsi.MarkerEngine = BlurrySiteMarkerEngine;
