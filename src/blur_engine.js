/**
 * blur_engine.js — PrivacyBlur Core Blur Engine
 *
 * Handles all DOM manipulation for blurring/unblurring elements.
 * Exposed as pb.BlurEngine (IIFE — no ES module syntax).
 *
 * Special handling:
 *  - All elements: CSS class (pb-blurred) + optional frosted class (pb-frosted)
 *  - CSS filter: blur() on parent blurs all descendants — no DOM injection needed
 *  - Video: CSS filter works on DRM video (DRM blocks pixel extraction, not rendering)
 *
 * Category-based blurring:
 *  - blurAllContent accepts an options.categories object to control which
 *    element groups are blurred (text, media, form, table, structure).
 *  - Selector strings are cached and rebuilt only when categories change.
 */

const BlurEngine = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants from shared definitions
  // -------------------------------------------------------------------------
  const BLUR_RADIUS        = pb.DEFAULT_SETTINGS.BLUR_RADIUS;
  const BLURRED_CLASS      = pb.CSS.BLURRED;
  const FROSTED_CLASS      = pb.CSS.FROSTED;
  const SVG_FILTER_ID      = pb.IDS.SVG_FILTERS;

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
  // Reads from pb.DEFAULT_SETTINGS to avoid duplicating values.
  const DEFAULT_CATS = pb.DEFAULT_SETTINGS.BLUR_CATEGORIES;

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
   * Checks whether `element` has direct text-node children with visible text.
   * Only checks immediate children — NOT descendant elements' text.
   * This is critical for STRUCTURE elements: a <div> with <p>text</p> should
   * NOT be blurred (the <p> is already handled by TEXT category). But a
   * <div>Plain text here</div> with direct text SHOULD be blurred.
   */
  function hasMeaningfulTextContent(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // SVG filter injection (frosted glass mode)
  // -------------------------------------------------------------------------

  /**
   * Injects an inline SVG element containing the frosted-glass filter into the
   * document body. The filter combines feTurbulence displacement with Gaussian
   * blur for AI-resistant obfuscation. Idempotent — only injects once.
   */
  function ensureSvgFilter() {
    if (document.getElementById(SVG_FILTER_ID)) return;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', SVG_FILTER_ID);
    svg.setAttribute('style', 'position:absolute;width:0;height:0');

    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', 'pb-frosted-filter');

    const turbulence = document.createElementNS(svgNS, 'feTurbulence');
    turbulence.setAttribute('type', 'turbulence');
    turbulence.setAttribute('baseFrequency', '0.04');
    turbulence.setAttribute('numOctaves', '3');
    turbulence.setAttribute('result', 'noise');

    const displacement = document.createElementNS(svgNS, 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'noise');
    displacement.setAttribute('scale', '12');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');

    const gaussianBlur = document.createElementNS(svgNS, 'feGaussianBlur');
    gaussianBlur.setAttribute('stdDeviation', '4');

    filter.appendChild(turbulence);
    filter.appendChild(displacement);
    filter.appendChild(gaussianBlur);
    svg.appendChild(filter);

    document.body.appendChild(svg);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Applies blur to an element.
   * @param {Element} element - The DOM element to blur
   * @param {number}  radius  - Blur radius in pixels (default 8)
   * @param {string}  [mode]  - Blur mode: 'gaussian' (default) or 'frosted'
   */
  function applyBlur(element, radius = BLUR_RADIUS, mode) {
    if (!element || !(element instanceof Element)) return;
    if (isBlurred(element)) return; // idempotent

    // Never blur extension UI elements (picker toolbar, toast notifications).
    const toolbarId = pb.IDS.PICKER_TOOLBAR;
    const toastClass = pb.CSS.TOAST;
    const toolbarClass = pb.CSS.TOOLBAR;
    if (element.id === toolbarId || element.closest('#' + toolbarId) ||
        element.classList.contains(toastClass) || element.closest('.' + toastClass) ||
        element.classList.contains(toolbarClass)) {
      return;
    }

    // ---- All elements: CSS class only ----
    // pb-blurred provides: filter blur, user-select none, contain paint.
    // pb-frosted adds: SVG displacement filter override (AI-resistant).
    // Both classes needed for frosted mode — pb-blurred is the base.
    element.classList.add(BLURRED_CLASS);
    if (mode === pb.BLUR_MODES.FROSTED) {
      ensureSvgFilter();
      element.classList.add(FROSTED_CLASS);
    }
  }

  /**
   * Removes blur from an element.
   * @param {Element} element - The DOM element to unblur
   */
  function removeBlur(element) {
    if (!element || !(element instanceof Element)) return;
    element.classList.remove(BLURRED_CLASS);
    element.classList.remove(FROSTED_CLASS);
  }

  /**
   * Toggles blur on an element: applies if not blurred, removes if blurred.
   * @param {Element} element
   * @param {number}  radius
   * @param {string}  [mode] - Blur mode: 'gaussian' (default) or 'frosted'
   */
  function toggleBlur(element, radius = BLUR_RADIUS, mode) {
    if (!element || !(element instanceof Element)) return;

    if (isBlurred(element)) {
      removeBlur(element);
    } else {
      applyBlur(element, radius, mode);
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
   * @param {string} [options.blurMode] - Blur mode: 'gaussian' (default) or
   *   'frosted'. When 'frosted', elements get the pb-frosted class in addition
   *   to pb-blurred, applying an SVG displacement + Gaussian blur filter.
   */
  function blurAllContent(radius = BLUR_RADIUS, options) {
    const cats = (options && options.categories) ? options.categories : DEFAULT_CATS;
    const thorough = !!(options && options.thoroughBlur);
    const mode = (options && options.blurMode) || pb.BLUR_MODES.GAUSSIAN; // Defaults to Gaussian

    // Inject SVG filter element when frosted mode is active
    if (mode === pb.BLUR_MODES.FROSTED) {
      ensureSvgFilter();
    }

    const { alwaysBlurSelector, textCheckSelector } = getSelectors(cats);

    // Pass 1: always-blur elements — blurred unconditionally.
    // Guard against empty selector (all categories off) which would throw.
    if (alwaysBlurSelector) {
      document.querySelectorAll(alwaysBlurSelector).forEach((el) => {
        applyBlur(el, radius, mode);
      });
    }

    // Pass 2: text-check elements.
    // Normal mode: blurred only when they have direct text-node children.
    // Thorough mode: blurred unconditionally (skips the text-check gate).
    if (textCheckSelector) {
      document.querySelectorAll(textCheckSelector).forEach((el) => {
        if (isBlurred(el)) return;
        if (thorough || hasMeaningfulTextContent(el)) {
          applyBlur(el, radius, mode);
        }
      });
    }
  }

  /**
   * Removes blur from every element on the page.
   */
  function unblurAll() {
    document.querySelectorAll(`.${BLURRED_CLASS}, .${FROSTED_CLASS}`).forEach((el) => {
      removeBlur(el);
    });
  }

  /**
   * Returns true if the element currently has blur applied.
   * @param {Element} element
   * @returns {boolean}
   */
  function isBlurred(element) {
    if (!element || !(element instanceof Element)) return false;

    return element.classList.contains(BLURRED_CLASS) || element.classList.contains(FROSTED_CLASS);
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
    ensureSvgFilter,
    CATEGORY_SELECTORS,
  };
})();

// Attach to window so content_script.js and other injected scripts can access it
pb.BlurEngine = BlurEngine;
