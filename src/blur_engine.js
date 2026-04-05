/**
 * blur_engine.js — PrivacyBlur Core Blur Engine
 *
 * Handles all DOM manipulation for blurring/unblurring elements.
 * Exposed as window.PrivacyBlurEngine (IIFE — no ES module syntax).
 *
 * Special handling:
 *  - IMG / background-image: CSS filter (fast, no artefacts)
 *  - VIDEO: canvas overlay with requestAnimationFrame (bypasses DRM filter restriction)
 *  - Text nodes: wrapped in <span> so CSS filter can target them
 *  - Generic elements: CSS class + custom property approach
 *
 * Category-based blurring:
 *  - blurAllContent accepts an options.categories object to control which
 *    element groups are blurred (text, media, form, table, structure).
 *  - Selector strings are cached and rebuilt only when categories change.
 */

const PrivacyBlurEngine = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Internal constants
  // -------------------------------------------------------------------------
  const BLURRED_CLASS      = "pb-blurred";
  const CANVAS_CLASS       = "pb-canvas-overlay";
  const TEXT_WRAPPER_CLASS = "pb-text-node-wrapper";

  // Map from video element -> { canvas, animFrameId } for cleanup
  const videoOverlayMap = new WeakMap();

  // -------------------------------------------------------------------------
  // Category selector definitions
  // -------------------------------------------------------------------------
  // Each category maps to two arrays: alwaysBlur (blurred unconditionally)
  // and textCheck (blurred only when hasMeaningfulTextContent returns true).
  // Frozen to prevent accidental mutation. Element lists sourced from
  // docs/BLUR_CATEGORIES.md research.

  const CATEGORY_SELECTORS = Object.freeze({
    TEXT: Object.freeze({
      alwaysBlur: Object.freeze([
        'h1','h2','h3','h4','h5','h6','p','blockquote','pre','figcaption','summary'
      ]),
      textCheck: Object.freeze([
        'li','dt','dd','span','a','label','em','strong','b','i','u','cite','q',
        'mark','abbr','time','address','small','code','kbd','samp','var','dfn',
        'data','del','ins','s','sub','sup','bdo','bdi'
      ]),
    }),
    MEDIA: Object.freeze({
      alwaysBlur: Object.freeze(['img','video','canvas']),
      textCheck:  Object.freeze([]),
    }),
    FORM: Object.freeze({
      alwaysBlur: Object.freeze(['input','textarea','select']),
      textCheck:  Object.freeze(['button','output','fieldset','legend']),
    }),
    TABLE: Object.freeze({
      alwaysBlur: Object.freeze(['caption']),
      textCheck:  Object.freeze(['td','th']),
    }),
    STRUCTURE: Object.freeze({
      alwaysBlur: Object.freeze([]),
      textCheck:  Object.freeze([
        'div','section','article','aside','header','footer','figure','details','dialog'
      ]),
    }),
  });

  // Fallback: all categories enabled. Used when options.categories is omitted.
  // Reads from PrivacyBlur.DEFAULT_SETTINGS to avoid duplicating values.
  const DEFAULT_CATS = (typeof globalThis !== 'undefined' && globalThis.PrivacyBlur && globalThis.PrivacyBlur.DEFAULT_SETTINGS)
    ? globalThis.PrivacyBlur.DEFAULT_SETTINGS.BLUR_CATEGORIES
    : Object.freeze({ TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true });

  // Category names in fixed order for cache key generation.
  const CATEGORY_ORDER = Object.freeze(['TEXT','MEDIA','FORM','TABLE','STRUCTURE']);

  // -------------------------------------------------------------------------
  // Selector cache
  // -------------------------------------------------------------------------
  // Stores pre-joined selector strings and a Set of active tag names.
  // Rebuilt only when the category toggles change (invalidated explicitly
  // or when the cache key no longer matches).
  let selectorCache = null;

  /**
   * Builds selector strings and a tag Set from the given category toggles.
   * @param {object} categories - { text: bool, media: bool, form: bool, table: bool, structure: bool }
   * @returns {{ key: string, alwaysBlurSelector: string, textCheckSelector: string, tagSet: Set<string> }}
   */
  function buildSelectors(categories) {
    const alwaysBlurTags = [];
    const textCheckTags  = [];

    for (const name of CATEGORY_ORDER) {
      if (!categories[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      // Push is faster than spread for known-length frozen arrays.
      for (let i = 0; i < cat.alwaysBlur.length; i++) alwaysBlurTags.push(cat.alwaysBlur[i]);
      for (let i = 0; i < cat.textCheck.length; i++)  textCheckTags.push(cat.textCheck[i]);
    }

    // Build a Set of all active tags for O(1) membership checks in
    // matchesActiveCategories. Both always-blur and text-check tags are
    // included because the MutationObserver needs to know if a newly
    // added element belongs to ANY active selector.
    const tagSet = new Set(alwaysBlurTags);
    for (let i = 0; i < textCheckTags.length; i++) tagSet.add(textCheckTags[i]);

    // Pre-join into comma-separated selector strings. A single compound
    // querySelectorAll("a,b,c") does one DOM walk — faster than N separate calls.
    const key = CATEGORY_ORDER.map(n => categories[n] ? '1' : '0').join('');

    return {
      key,
      alwaysBlurSelector: alwaysBlurTags.join(','),
      textCheckSelector:  textCheckTags.join(','),
      tagSet,
    };
  }

  /**
   * Returns cached selectors if the category toggles match, else rebuilds.
   */
  function getSelectors(categories) {
    const key = CATEGORY_ORDER.map(n => categories[n] ? '1' : '0').join('');
    if (selectorCache && selectorCache.key === key) return selectorCache;
    selectorCache = buildSelectors(categories);
    return selectorCache;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether `element` is a bare text node container that should be
   * treated as text content (i.e. has at least one direct text-node child
   * with non-whitespace content, but no meaningful child elements).
   */
  function hasMeaningfulTextContent(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Wraps a bare text-node inside a <span> so the CSS blur filter can target
   * a block-level or inline element rather than trying to filter a text node
   * directly (which is not supported).
   * Returns the wrapper span, or null if there was nothing to wrap.
   */
  function wrapTextNodes(element) {
    const nodesToWrap = [];

    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        nodesToWrap.push(node);
      }
    }

    if (nodesToWrap.length === 0) return null;

    const span = document.createElement("span");
    span.classList.add(TEXT_WRAPPER_CLASS);

    // Insert wrapper before the first text node, then move all text nodes into it.
    // Using appendChild (move) instead of cloneNode preserves live references.
    const firstNode = nodesToWrap[0];
    element.insertBefore(span, firstNode);
    for (const node of nodesToWrap) {
      span.appendChild(node);
    }

    return span;
  }

  /**
   * Creates a <canvas> overlay on top of a video element and starts a
   * requestAnimationFrame loop that draws blurred video frames onto it.
   * This works for DRM-protected video because we are not reading pixel data —
   * we are re-rendering using the CSS filter on the canvas context.
   */
  function startVideoBlurCanvas(videoElement, radius) {
    // If an overlay already exists, stop old one first
    stopVideoBlurCanvas(videoElement);

    const canvas = document.createElement("canvas");
    canvas.classList.add(CANVAS_CLASS);

    // Position canvas exactly over the video
    const rect = videoElement.getBoundingClientRect();
    canvas.width  = videoElement.videoWidth  || rect.width;
    canvas.height = videoElement.videoHeight || rect.height;

    Object.assign(canvas.style, {
      position:      "absolute",
      top:           "0",
      left:          "0",
      width:         "100%",
      height:        "100%",
      pointerEvents: "none",  // clicks pass through to video controls
      zIndex:        "9999"
    });

    // The video container must be positioned so the canvas can overlay it
    const videoParent = videoElement.parentElement;

    // Guard: if video has no parent (detached from DOM) we cannot overlay a canvas.
    if (!videoParent) {
      videoElement.classList.add(BLURRED_CLASS);
      videoElement.style.setProperty("--pb-radius", `${radius}px`);
      return;
    }

    const parentPos = window.getComputedStyle(videoParent).position;
    if (parentPos === "static") {
      videoParent.style.position = "relative";
    }

    videoParent.insertBefore(canvas, videoElement.nextSibling);

    const ctx = canvas.getContext("2d");

    // Use an object so drawFrame always writes the latest handle into the same
    // reference that videoOverlayMap holds. Storing animFrameId by value would
    // capture the handle from frame 0 only; subsequent frames update the closure
    // variable but the map would hold a stale handle, making cancelAnimationFrame
    // cancel the wrong frame and leave the loop running.
    const state = { canvas, animFrameId: null, originalParentPosition: parentPos };

    function drawFrame() {
      // Resize canvas if video dimensions changed (e.g., fullscreen, resolution switch)
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        if (canvas.width !== videoElement.videoWidth || canvas.height !== videoElement.videoHeight) {
          canvas.width  = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
        }
      } else if (canvas.width === 0 || canvas.height === 0) {
        // Video metadata not yet loaded — fall back to layout dimensions
        const r = videoElement.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          canvas.width  = r.width;
          canvas.height = r.height;
        }
      }

      // Stop if video was removed from DOM (SPA navigation, dynamic content)
      if (!videoElement.isConnected) {
        stopVideoBlurCanvas(videoElement);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply blur filter via the canvas 2D context (not CSS), then draw frame
      ctx.filter = `blur(${radius}px)`;
      try {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      } catch {
        // drawImage can throw for cross-origin or DRM videos — keep looping
        // so the solid-colour canvas remains visible as a visual mask
        ctx.fillStyle = "rgba(30, 30, 30, 0.85)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      state.animFrameId = requestAnimationFrame(drawFrame);
    }

    drawFrame();

    videoOverlayMap.set(videoElement, state);
  }

  /**
   * Stops the canvas overlay loop and removes the canvas from the DOM.
   */
  function stopVideoBlurCanvas(videoElement) {
    const overlay = videoOverlayMap.get(videoElement);
    if (!overlay) return;

    cancelAnimationFrame(overlay.animFrameId);

    if (overlay.canvas && overlay.canvas.parentNode) {
      const parent = overlay.canvas.parentNode;
      parent.removeChild(overlay.canvas);
      // Restore parent's original position if we changed it
      if (overlay.originalParentPosition) {
        parent.style.position = overlay.originalParentPosition;
      }
    }

    videoOverlayMap.delete(videoElement);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Applies blur to an element.
   * @param {Element} element - The DOM element to blur
   * @param {number}  radius  - Blur radius in pixels (default 8)
   */
  function applyBlur(element, radius = 8) {
    if (!element || !(element instanceof Element)) return;
    if (isBlurred(element)) return; // idempotent

    // Never blur elements created by the blur engine itself.
    // TEXT_WRAPPER_CLASS guard is critical: without it, a MutationObserver
    // watching for new nodes creates an infinite loop (wrapTextNodes inserts
    // a span → observer fires → applyBlur wraps again → observer fires → …).
    // CANVAS_CLASS guard prevents double-blurring video overlay canvases.
    if (element.classList.contains(TEXT_WRAPPER_CLASS) ||
        element.classList.contains(CANVAS_CLASS)) {
      return;
    }

    const tag = element.tagName.toLowerCase();

    // ---- VIDEO: canvas overlay approach ----
    // No per-element --pb-radius needed — the canvas overlay reads `radius`
    // from the closure, not from CSS. The CSS class provides a fallback
    // filter via var(--pb-radius) from :root for the brief moment before
    // the canvas overlay is drawn.
    if (tag === "video") {
      element.classList.add(BLURRED_CLASS);
      startVideoBlurCanvas(element, radius);
      return;
    }

    // ---- IMG: CSS class only (no inline filter) ----
    // The .pb-blurred CSS rule applies filter via var(--pb-radius) from :root.
    // No inline style.filter — it would override the CSS variable and prevent
    // live radius updates from propagating without a page reload.
    if (tag === "img") {
      element.classList.add(BLURRED_CLASS);
      return;
    }

    // ---- Text-containing elements: wrap bare text nodes if needed ----
    // Check text content BEFORE background-image so we only call
    // getComputedStyle (which forces a synchronous reflow) on elements
    // that actually have text to wrap. Elements without text get the
    // blur class either way — the background-image check only matters
    // to decide whether to skip wrapTextNodes.
    if (hasMeaningfulTextContent(element)) {
      // If the element has a background-image, CSS filter handles the blur
      // via the class alone — don't wrap text nodes (the background is the
      // primary visual content, not the text overlay).
      const bgImage = window.getComputedStyle(element).backgroundImage;
      if (!(bgImage && bgImage !== "none" && tag !== "body" && tag !== "html")) {
        wrapTextNodes(element);
      }
    }

    // ---- Generic element: class only ----
    // CSS .pb-blurred uses var(--pb-radius) from :root, set by applySettingsToDom().
    // No per-element --pb-radius — this lets radius changes propagate instantly.
    element.classList.add(BLURRED_CLASS);
  }

  /**
   * Removes blur from an element.
   * @param {Element} element - The DOM element to unblur
   */
  function removeBlur(element) {
    if (!element || !(element instanceof Element)) return;

    const tag = element.tagName.toLowerCase();

    // ---- VIDEO: stop canvas overlay ----
    if (tag === "video") {
      element.classList.remove(BLURRED_CLASS);
      element.style.removeProperty("--pb-radius");
      stopVideoBlurCanvas(element);
      return;
    }

    // ---- IMG: remove class only ----
    if (tag === "img") {
      element.classList.remove(BLURRED_CLASS);
      return;
    }

    // ---- Generic element ----
    element.classList.remove(BLURRED_CLASS);

    // Clean up any text-node wrappers this engine introduced
    const textWrappers = element.querySelectorAll(`.${TEXT_WRAPPER_CLASS}`);
    textWrappers.forEach((wrapper) => {
      // Unwrap: replace wrapper with its children
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });
  }

  /**
   * Toggles blur on an element: applies if not blurred, removes if blurred.
   * @param {Element} element
   * @param {number}  radius
   */
  function toggleBlur(element, radius = 8) {
    if (!element || !(element instanceof Element)) return;

    if (isBlurred(element)) {
      removeBlur(element);
    } else {
      applyBlur(element, radius);
    }
  }

  /**
   * Blurs all meaningful content elements on the page.
   * Uses a two-pass model: always-blur elements are blurred unconditionally,
   * text-check elements are blurred only when they have direct text content.
   *
   * @param {number} radius  - Blur radius in pixels (default 8)
   * @param {object} [options] - Configuration object
   * @param {object} [options.categories] - Category toggles: { text, media, form, table, structure }.
   *   Each key is a boolean. Omitted keys default to true. If options.categories
   *   is not provided, all categories are enabled (backward compatible).
   * @param {boolean} [options.thoroughBlur] - When true, skips the
   *   hasMeaningfulTextContent gate on text-check elements, blurring them
   *   unconditionally. Catches containers where text lives entirely in child
   *   elements, at the cost of also blurring empty layout wrappers and
   *   icon-only elements.
   */
  function blurAllContent(radius = 8, options) {
    const cats = (options && options.categories) ? options.categories : DEFAULT_CATS;
    const thorough = !!(options && options.thoroughBlur);
    const { alwaysBlurSelector, textCheckSelector } = getSelectors(cats);

    // Pass 1: always-blur elements — blurred unconditionally.
    // Guard against empty selector (all categories off) which would throw.
    if (alwaysBlurSelector) {
      document.querySelectorAll(alwaysBlurSelector).forEach((el) => {
        applyBlur(el, radius);
      });
    }

    // Pass 2: text-check elements.
    // Normal mode: blurred only when they have direct text-node children.
    // Thorough mode: blurred unconditionally (skips the text-check gate).
    if (textCheckSelector) {
      document.querySelectorAll(textCheckSelector).forEach((el) => {
        if (el.classList.contains(BLURRED_CLASS)) return;
        if (thorough || hasMeaningfulTextContent(el)) {
          applyBlur(el, radius);
        }
      });
    }
  }

  /**
   * Removes blur from every element on the page that has the blur class,
   * including any canvas overlays and img wrappers.
   */
  function unblurAll() {
    // Handle video elements first to cancel rAF loops
    document.querySelectorAll(`video.${BLURRED_CLASS}`).forEach((el) => {
      removeBlur(el);
    });

    // Handle all remaining blurred elements
    document.querySelectorAll(`.${BLURRED_CLASS}`).forEach((el) => {
      removeBlur(el);
    });

    // Clean up any orphaned text-node wrappers
    document.querySelectorAll(`.${TEXT_WRAPPER_CLASS}`).forEach((wrapper) => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });

    // Remove any orphaned canvas overlays
    document.querySelectorAll(`.${CANVAS_CLASS}`).forEach((canvas) => {
      canvas.parentNode && canvas.parentNode.removeChild(canvas);
    });
  }

  /**
   * Returns true if the element currently has blur applied.
   * @param {Element} element
   * @returns {boolean}
   */
  function isBlurred(element) {
    if (!element || !(element instanceof Element)) return false;

    return element.classList.contains(BLURRED_CLASS);
  }

  /**
   * Drops the cached selector strings so the next blurAllContent call
   * rebuilds them. Call this when category settings change.
   */
  function invalidateSelectorCache() {
    selectorCache = null;
  }

  /**
   * Returns true if the element's tag belongs to any enabled category.
   * Used by the MutationObserver to decide whether a dynamically added
   * node should be blurred in blur-all mode.
   *
   * @param {Element} element    - The DOM element to check
   * @param {object}  categories - Category toggles (same shape as options.categories)
   * @returns {boolean}
   */
  function matchesActiveCategories(element, categories) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const { tagSet } = getSelectors(cats);
    return tagSet.has(element.tagName.toLowerCase());
  }

  /**
   * Returns true if the element should be blurred in blur-all mode,
   * applying the same two-pass logic as blurAllContent:
   * - Always-blur elements → true unconditionally
   * - Text-check elements → true only if hasMeaningfulTextContent
   *
   * This is what the MutationObserver should use instead of
   * matchesActiveCategories (which skips the text-check gate).
   */
  function shouldBlurElement(element, categories, thorough) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const tag = element.tagName.toLowerCase();

    // Check each enabled category
    for (const name of CATEGORY_ORDER) {
      if (!cats[name]) continue;
      const cat = CATEGORY_SELECTORS[name];

      // Always-blur: unconditional
      if (cat.alwaysBlur.indexOf(tag) >= 0) return true;

      // Text-check: only if element has meaningful text (or thorough mode)
      if (cat.textCheck.indexOf(tag) >= 0) {
        return thorough || hasMeaningfulTextContent(element);
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    applyBlur,
    removeBlur,
    toggleBlur,
    blurAllContent,
    unblurAll,
    isBlurred,
    invalidateSelectorCache,
    matchesActiveCategories,
    shouldBlurElement,
    CATEGORY_SELECTORS,
  };
})();

// Attach to window so content_script.js and other injected scripts can access it
window.PrivacyBlurEngine = PrivacyBlurEngine;
