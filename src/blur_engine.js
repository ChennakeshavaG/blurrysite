/**
 * blur_engine.js — Blurry Site Core Blur Engine
 *
 * Hybrid CSS + data-attribute blur system:
 *  - Always-blur tags (h1, p, img, etc.) → injected <style> with tag selectors
 *  - Text-check tags (div, span, li, etc.) → data-bl-si-blur attribute after text gate
 *  - Picker/context menu → data-bl-si-blur on individual elements
 *
 * CSS auto-applies to always-blur elements (present + future). No per-element
 * DOM mutations for those tags. Text-check elements use data-bl-si-blur attribute
 * which doesn't trigger framework re-render loops (unlike classList).
 *
 * Exposed as blsi.BlurEngine (IIFE — no ES module syntax).
 */

const BlurEngine = (() => {
  'use strict';

  const SVG_FILTER_ID = blsi.IDS.SVG_FILTERS;
  const STYLE_ID      = 'bl-si-blur-styles';

  // ── Category selector definitions ──────────────────────────────────────────

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

  const DEFAULT_CATS = blsi.DEFAULT_SETTINGS.BLUR_CATEGORIES;
  const CATEGORY_ORDER = Object.freeze(['TEXT','MEDIA','FORM','TABLE','STRUCTURE']);

  // ── Selector cache ─────────────────────────────────────────────────────────

  let selectorCache = null;

  function buildSelectors(categories) {
    const alwaysBlurTags = [];
    const textCheckTags  = [];

    for (const name of CATEGORY_ORDER) {
      if (!categories[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      for (let i = 0; i < cat.alwaysBlur.length; i++) alwaysBlurTags.push(cat.alwaysBlur[i]);
      for (let i = 0; i < cat.textCheck.length; i++)  textCheckTags.push(cat.textCheck[i]);
    }

    const tagSet = new Set(alwaysBlurTags);
    for (let i = 0; i < textCheckTags.length; i++) tagSet.add(textCheckTags[i]);

    const key = CATEGORY_ORDER.map(n => categories[n] ? '1' : '0').join('');

    return {
      key,
      alwaysBlurSelector: alwaysBlurTags.join(','),
      textCheckSelector:  textCheckTags.join(','),
      alwaysBlurTags,
      textCheckTags,
      tagSet,
    };
  }

  function getSelectors(categories) {
    const key = CATEGORY_ORDER.map(n => categories[n] ? '1' : '0').join('');
    if (selectorCache && selectorCache.key === key) return selectorCache;
    selectorCache = buildSelectors(categories);
    return selectorCache;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  function hasMeaningfulTextContent(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Structural container tags — wrappers that group content but rarely hold
   * private text directly. Blurring these creates redundant nested blur that
   * breaks hover reveal (CSS filter on a parent composites the entire subtree,
   * so unblurring a parent leaks all siblings). These always require the
   * hasMeaningfulTextContent gate, even in thorough mode.
   */
  const _structuralTags = new Set(
    CATEGORY_SELECTORS.STRUCTURE.textCheck
  );

  /** Set of text-check tag names for O(1) lookup in MO callback */
  let _textCheckSet = new Set();

  function _rebuildTextCheckSet(categories) {
    _textCheckSet = new Set();
    const cats = categories || DEFAULT_CATS;
    for (const name of CATEGORY_ORDER) {
      if (!cats[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      for (let i = 0; i < cat.textCheck.length; i++) _textCheckSet.add(cat.textCheck[i]);
    }
  }

  // ── SVG filter injection (frosted glass mode) ──────────────────────────────

  function ensureSvgFilter() {
    if (document.getElementById(SVG_FILTER_ID)) return;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', SVG_FILTER_ID);
    svg.setAttribute('style', 'position:absolute;width:0;height:0');

    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', 'bl-si-frosted-filter');

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

  // ── CSS Rule Injection (always-blur tags) ──────────────────────────────────

  let _styleEl = null;

  // Extension UI exclusion — prevents our own toolbar/toast from being blurred
  const EXCLUDE = ':not(#bl-si-picker-toolbar):not(#bl-si-picker-toolbar *)' +
                  ':not(.bl-si-toast):not(.bl-si-toast *)' +
                  ':not(.bl-si-toolbar):not(.bl-si-toolbar *)';

  /**
   * Inject CSS rules for blur-all mode.
   * Always-blur tags get tag-based CSS selectors.
   * Text-check elements are handled by blurTextCheckElements() via data attribute.
   * Also injects the [data-bl-si-blur] rule for text-check and picker elements.
   */
  function injectBlurRules(categories, mode) {
    removeBlurRules();

    if (mode === blsi.BLUR_MODES.FROSTED) ensureSvgFilter();

    const cats = categories || DEFAULT_CATS;
    const { alwaysBlurSelector } = getSelectors(cats);
    _rebuildTextCheckSet(cats);

    const filterValue = mode === blsi.BLUR_MODES.FROSTED
      ? 'url(#bl-si-frosted-filter)'
      : 'blur(var(--bl-si-radius, 10px))';

    const blurDecl = `filter: ${filterValue} !important; user-select: none !important;`;

    const rules = [];

    // Always-blur tags via CSS — auto-applies to present + future elements
    if (alwaysBlurSelector) {
      const excluded = alwaysBlurSelector.split(',').map(t => t.trim() + EXCLUDE).join(',');
      rules.push(`${excluded} { ${blurDecl} }`);
    }

    // Data attribute rule — for text-check elements and individual picker blurs
    rules.push(`[data-bl-si-blur] { ${blurDecl} }`);

    if (rules.length === 0) return;

    _styleEl = document.createElement('style');
    _styleEl.id = STYLE_ID;
    _styleEl.textContent = rules.join('\n');
    document.head.appendChild(_styleEl);
  }

  function removeBlurRules() {
    if (_styleEl && _styleEl.parentNode) {
      _styleEl.parentNode.removeChild(_styleEl);
    }
    _styleEl = null;
  }

  function isBlurAllActive() {
    return _styleEl !== null && _styleEl.parentNode !== null;
  }

  // ── Text-check element blur (one-time scan + MO for new ones) ──────────────

  /**
   * One-time scan: find all text-check elements with meaningful text and
   * stamp data-bl-si-blur on them. Called once on blur-all toggle.
   */
  function blurTextCheckElements(categories, thorough) {
    const { textCheckSelector } = getSelectors(categories || DEFAULT_CATS);
    if (!textCheckSelector) return;

    document.querySelectorAll(textCheckSelector).forEach(el => {
      if (el.dataset.blSiBlur) return; // already stamped
      if (_isExtensionUI(el)) return;
      // Structural containers (div, section, etc.) always require the text gate —
      // blurring wrappers creates nested blur that breaks hover reveal.
      // Thorough mode only bypasses the gate for inline content elements.
      const needsTextGate = _structuralTags.has(el.tagName.toLowerCase());
      if (needsTextGate) {
        if (hasMeaningfulTextContent(el)) el.dataset.blSiBlur = '1';
      } else if (thorough || hasMeaningfulTextContent(el)) {
        el.dataset.blSiBlur = '1';
      }
    });
  }

  /**
   * Check if a single text-check element should be blurred and stamp it.
   * Used by MutationObserver for dynamically added elements.
   */
  function tryBlurTextCheck(element, thorough) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur) return;
    if (_isExtensionUI(element)) return;
    const tag = element.tagName.toLowerCase();
    if (!_textCheckSet.has(tag)) return;
    const needsTextGate = _structuralTags.has(tag);
    if (needsTextGate) {
      if (hasMeaningfulTextContent(element)) element.dataset.blSiBlur = '1';
    } else if (thorough || hasMeaningfulTextContent(element)) {
      element.dataset.blSiBlur = '1';
    }
  }

  function _isExtensionUI(element) {
    const toolbarId = blsi.IDS.PICKER_TOOLBAR;
    return element.id === toolbarId || element.closest('#' + toolbarId) ||
           element.classList.contains(blsi.CSS.TOAST) || element.closest('.' + blsi.CSS.TOAST) ||
           element.classList.contains(blsi.CSS.TOOLBAR) ||
           element.dataset.blSiZone !== undefined;
  }

  // ── Individual element blur (picker / context menu) ────────────────────────

  function applyBlur(element) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur) return;
    if (_isExtensionUI(element)) return;
    element.dataset.blSiBlur = '1';
  }

  function removeBlur(element) {
    if (!element || !(element instanceof Element)) return;
    delete element.dataset.blSiBlur;
  }

  function toggleBlur(element) {
    if (!element || !(element instanceof Element)) return;
    if (isBlurred(element)) {
      removeBlur(element);
    } else {
      applyBlur(element);
    }
  }

  function isBlurred(element) {
    if (!element || !(element instanceof Element)) return false;
    // Individual data attribute blur
    if (element.dataset.blSiBlur) return true;
    // Blur-all CSS rule: check if tag matches an always-blur selector
    if (isBlurAllActive() && selectorCache) {
      const tag = element.tagName.toLowerCase();
      // Only always-blur tags are covered by CSS. Text-check tags need data attr.
      for (let i = 0; i < selectorCache.alwaysBlurTags.length; i++) {
        if (selectorCache.alwaysBlurTags[i] === tag) return true;
      }
    }
    return false;
  }

  function unblurAll() {
    removeBlurRules();
    document.querySelectorAll('[data-bl-si-blur]').forEach(el => {
      delete el.dataset.blSiBlur;
    });
    removeAllZoneOverlays();
  }

  function invalidateSelectorCache() {
    selectorCache = null;
  }

  function matchesActiveCategories(element, categories) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const { tagSet } = getSelectors(cats);
    return tagSet.has(element.tagName.toLowerCase());
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
    return false;
  }

  // ── Sticky zone overlays ───────────────────────────────────────────────────

  /** Map of active zone overlays: zoneId → DOM element */
  const _zoneOverlays = new Map();

  /**
   * Create and inject a sticky zone overlay div into document.body.
   * @param {object} zoneData - { id, name, x, y, width, height, ... }
   * @returns {HTMLElement} The created overlay element
   */
  function createZoneOverlay(zoneData) {
    if (!zoneData || !zoneData.id) return null;

    if (!document.body) return null;

    // Remove existing overlay with same id (idempotent)
    if (_zoneOverlays.has(zoneData.id)) {
      removeZoneOverlay(zoneData.id);
    }

    const el = document.createElement('div');
    el.className = blsi.CSS.ZONE_OVERLAY;
    el.dataset.blSiZone = zoneData.id;
    el.dataset.blSiZoneName = zoneData.name || '';

    el.style.cssText = [
      'position: absolute',
      'left: ' + zoneData.x + 'px',
      'top: ' + zoneData.y + 'px',
      'width: ' + zoneData.width + 'px',
      'height: ' + zoneData.height + 'px',
    ].join('; ') + ';';

    document.body.appendChild(el);
    _zoneOverlays.set(zoneData.id, el);
    return el;
  }

  /**
   * Remove a sticky zone overlay by id.
   * @param {string} zoneId
   */
  function removeZoneOverlay(zoneId) {
    const el = _zoneOverlays.get(zoneId);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
    _zoneOverlays.delete(zoneId);
  }

  /**
   * Get all active zone overlay elements.
   * @returns {Array<HTMLElement>}
   */
  function getZoneOverlays() {
    return Array.from(_zoneOverlays.values());
  }

  /**
   * Remove all zone overlays from the DOM.
   */
  function removeAllZoneOverlays() {
    for (const [id, el] of _zoneOverlays) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    _zoneOverlays.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // Blur-all
    injectBlurRules,
    removeBlurRules,
    isBlurAllActive,
    blurTextCheckElements,
    tryBlurTextCheck,

    // Individual element
    applyBlur,
    removeBlur,
    toggleBlur,
    unblurAll,

    // Queries
    isBlurred,
    matchesActiveCategories,
    shouldBlurElement,

    // Sticky zones
    createZoneOverlay,
    removeZoneOverlay,
    getZoneOverlays,
    removeAllZoneOverlays,

    // Utilities
    invalidateSelectorCache,
    ensureSvgFilter,
    CATEGORY_SELECTORS,
  };
})();

blsi.BlurEngine = BlurEngine;
