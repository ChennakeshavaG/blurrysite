/**
 * core/marker_engine.js — element-level blur stamping + match queries.
 *
 * Owns every operation that toggles `data-bl-si-blur` on an individual
 * Element: the page-wide stamp pass, the MO-fed single-node check, the
 * picker apply/remove paths, and the predicates picker / reveal_controller
 * use to decide whether an element is currently blurred.
 *
 * Cross-module reads:
 *   - blsi.Categories.{CATEGORY_SELECTORS, CATEGORY_ORDER, DEFAULT_CATS}
 *   - blsi.CssManager.{getSelectors, getLastSelectorCache, isBlurAllActive}
 * Cross-module writes:
 *   - blsi.EngineState.{incrementBlurredCount, decrementBlurredCount}
 *
 * Inbound calls:
 *   - css_manager.injectRules() → MarkerEngine.rebuildTextCheckSet(cats)
 *   - observer.js MO callback → MarkerEngine.tryBlurTextCheck, stampElements
 *   - target_engine.js → MarkerEngine._isExtensionUI (gates pick-blur stamps)
 *   - picker.js (via Engine facade) → applyBlur, removeBlur, isBlurred
 *   - reveal_controller.js (via Engine facade) → isVisuallyBlurred
 *
 * Exposed as blsi.MarkerEngine (IIFE — no ES module syntax).
 */

const BlurrySiteMarkerEngine = (() => {
  'use strict';

  const Cats = blsi.Categories;
  const Css  = blsi.CssManager;
  const State = blsi.EngineState;

  const CATEGORY_SELECTORS = Cats.CATEGORY_SELECTORS;
  const CATEGORY_ORDER     = Cats.CATEGORY_ORDER;
  const DEFAULT_CATS       = Cats.DEFAULT_CATS;

  /** Set of text-check tag names for O(1) lookup in MO callback */
  let _textCheckSet = new Set();
  let _lastTextCheckKey = null;

  function rebuildTextCheckSet(categories) {
    const cats = categories || DEFAULT_CATS;
    const key = CATEGORY_ORDER.filter(n => cats[n]).join(',');
    if (key === _lastTextCheckKey) return;
    _lastTextCheckKey = key;
    _textCheckSet = new Set();
    for (const name of CATEGORY_ORDER) {
      if (!cats[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      for (let i = 0; i < cat.textCheck.length; i++)
        _textCheckSet.add(cat.textCheck[i]);
    }
  }

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
      element.dataset.blSiZone !== undefined
    );
  }

  // ── Text-check element blur (scan + MO for new nodes) ─────────────────────

  /**
   * Scan elements in `root`, stamp `data-bl-si-blur` on text-check elements
   * matching the active categories, and collect any open shadow roots found
   * during the traversal — all in ONE querySelectorAll('*') pass.
   *
   * Returns the discovered ShadowRoot[] so the caller (_flushStampQueue) can
   * dispatch into them after this root is fully processed. No shadowCb param —
   * the caller owns dispatch so shadow roots are never processed mid-loop.
   */
  function stampElements(root, categories, thorough, mode) {
    const cats = categories || DEFAULT_CATS;
    rebuildTextCheckSet(cats);

    // Collect shadow roots piggybacked on the stamp pass — no extra traversal.
    const shadowRoots = [];

    root.querySelectorAll('*').forEach((el) => {
      // Inline stale-clear — avoids a separate querySelectorAll('[data-bl-si-blur]')
      // pre-pass. PII-stamped elements keep their stamp (they own their blur lifecycle).
      if (el.dataset.blSiBlur && !el.dataset.blSiPii) { delete el.dataset.blSiBlur; State.decrementBlurredCount(); }

      // Shadow root discovery: collect for post-stamp dispatch by caller.
      // CSS injected into each shadow root handles alwaysBlur declaratively;
      // text-check stamping happens when caller recurses via _flushStampQueue.
      if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

      const tag = el.tagName.toLowerCase();

      // Cross-origin iframe — stamp as a black-box. Same-origin iframes
      // self-handle via all_frames:true (they get their own content_script)
      // so we skip them. Initial iframes at page load were previously missed
      // because they're not in _textCheckSet and only the MO-fed handleIframe
      // path used to stamp them — only fired for dynamically inserted iframes.
      if (tag === 'iframe') {
        if (!el.dataset.blSiBlur && !_isExtensionUI(el)) {
          let isSameOrigin = false;
          try { isSameOrigin = !!el.contentDocument; } catch (_) { /* cross-origin */ }
          if (!isSameOrigin) {
            el.dataset.blSiBlur = '1';
            State.incrementBlurredCount();
          }
        }
        return;
      }

      // Custom element host stamping — hyphenated tag names never land in
      // _textCheckSet (which only contains known HTML elements). Stamp the
      // host itself so light-DOM-only custom elements (e.g. <shreddit-foo>)
      // aren't invisible to blur. Shadow root content is handled separately
      // via _flushStampQueue recursion. Gated on STRUCTURE or TEXT active.
      if (tag.includes('-')) {
        if (!el.dataset.blSiBlur && !el.dataset.blSiPickBlur && !el.dataset.blSiPii && !_isExtensionUI(el) &&
            (cats.structure !== false || cats.text !== false) &&
            (thorough || hasMeaningfulTextContent(el))) {
          el.dataset.blSiBlur = '1';
          State.incrementBlurredCount();
        }
        return;
      }

      // Text-check stamping
      if (!_textCheckSet.has(tag)) return;
      if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return; // already stamped or owned by a competing blur system
      if (_isExtensionUI(el)) return;
      // Structural containers (div, section, etc.) always require the text gate —
      // blurring wrappers creates nested blur that breaks hover reveal.
      // Thorough mode only bypasses the gate for inline content elements.
      const needsTextGate = _structuralTags.has(tag);
      let shouldStamp = false;
      if (needsTextGate) {
        shouldStamp = hasMeaningfulTextContent(el);
      } else {
        // For inline/phrasing content (a, span, em, etc.): also stamp if the
        // element contains a <slot> descendant — shadow DOM projection means the
        // slot renders light-DOM content visually (text, images) even though the
        // shadow element itself has no direct text nodes. CSS filter on the
        // stamped element blurs the projected slot content correctly.
        shouldStamp = thorough || hasMeaningfulTextContent(el) ||
          !!(el.querySelector && el.querySelector('slot'));
      }
      if (shouldStamp) {
        el.dataset.blSiBlur = "1";
        State.incrementBlurredCount();
      }
    });

    return shadowRoots;
  }

  /**
   * Check if a single text-check element should be blurred and stamp it.
   * Used by MutationObserver for dynamically added elements.
   */
  function tryBlurTextCheck(element, thorough) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur || element.dataset.blSiPickBlur || element.dataset.blSiPii) return;
    if (_isExtensionUI(element)) return;
    const tag = element.tagName.toLowerCase();
    if (!_textCheckSet.has(tag)) return;
    const needsTextGate = _structuralTags.has(tag);
    if (needsTextGate) {
      if (hasMeaningfulTextContent(element)) { element.dataset.blSiBlur = "1"; State.incrementBlurredCount(); }
    } else if (thorough || hasMeaningfulTextContent(element) ||
               !!(element.querySelector && element.querySelector('slot'))) {
      // slot check: dynamically added shadow DOM elements with <slot> descendants
      // render projected light-DOM content — stamp them even without direct text.
      element.dataset.blSiBlur = "1"; State.incrementBlurredCount();
    }
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

  function shouldBlurElement(element, categories, thorough) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const tag = element.tagName.toLowerCase();

    for (const name of CATEGORY_ORDER) {
      if (!cats[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      if (cat.alwaysBlur.indexOf(tag) >= 0) return true;
      if (cat.textCheck.indexOf(tag) >= 0) {
        return thorough || hasMeaningfulTextContent(element);
      }
    }

    // Role-based match: treated as alwaysBlur (no text gate). Checked after
    // tag-based paths so a native <button> is matched by its tag first.
    const { roleSet } = Css.getSelectors(cats);
    if (roleSet.size > 0) {
      const role = element.getAttribute("role");
      if (role != null && roleSet.has(role)) return true;
    }
    return false;
  }

  return {
    // Text-check tag set sync (called by css_manager.injectRules).
    rebuildTextCheckSet,

    // Element-level apply/remove (picker / context menu).
    applyBlur,
    removeBlur,

    // Match queries.
    isBlurred,
    isVisuallyBlurred,
    matchesActiveCategories,
    shouldBlurElement,

    // Page-wide + single-node stamp paths.
    stampElements,
    tryBlurTextCheck,

    // Utility — exported for target_engine to gate pick-blur stamps.
    _isExtensionUI,
  };
})();

blsi.MarkerEngine = BlurrySiteMarkerEngine;
