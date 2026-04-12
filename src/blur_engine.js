/**
 * blur_engine.js — Blurry Site Core Blur Engine
 *
 * Hybrid CSS + data-attribute blur system:
 *  - CSS Style Cases -> Always-blur tags (h1, p, img, etc.) → injected <style> with tag selectors
 *  - DOM Mutation Observer Cases ->Text-check tags (div, span, li, etc.) → data-bl-si-blur attribute.
 *  - Picker/context menu → data-bl-si-blur on individual elements
 *
 * Uses attributes instead of class based to avoid issues from redering frameworks which primarly work on class changes (React, Vue .,etc)
 * This Attribute approach makes the blurring less susceptible to website functionality breakagaes
 *
 * Exposed as blsi.BlurEngine (IIFE — no ES module syntax).
 */

const BlurEngine = (() => {
  "use strict";

  const SVG_FILTER_ID = blsi.IDS.SVG_FILTERS;
  const STYLE_ID = "bl-si-blur-styles";

  // ── Category selector definitions ──────────────────────────────────────────

  const CATEGORY_SELECTORS = Object.freeze({
    TEXT: Object.freeze({
      alwaysBlur: Object.freeze([
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hgroup",
        "p",
        "blockquote",
        "pre",
        "figcaption",
        "summary",
      ]),
      textCheck: Object.freeze([
        "span",
        "a",
        "label",
        "em",
        "strong",
        "b",
        "i",
        "u",
        "cite",
        "q",
        "mark",
        "abbr",
        "time",
        "address",
        "small",
        "code",
        "kbd",
        "samp",
        "var",
        "dfn",
        "data",
        "del",
        "ins",
        "s",
        "sub",
        "sup",
        "bdo",
        "bdi",
        "ruby",
        "rt",
        "rp",
      ]),
    }),
    MEDIA: Object.freeze({
      alwaysBlur: Object.freeze(["img", "video", "audio", "canvas", "svg"]),
      textCheck: Object.freeze([]),
    }),
    FORM: Object.freeze({
      alwaysBlur: Object.freeze([
        "input",
        "textarea",
        "select",
        "progress",
        "meter",
      ]),
      textCheck: Object.freeze(["button", "output", "fieldset", "legend"]),
      // ARIA role coverage — SPA sites (GitHub, Figma, Notion) use role-based
      // interactivity extensively. Matched via CSS attribute selectors in
      // buildSelectors so a <div role="button"> gets blurred alongside native
      // <button>. Keep in sync with WAI-ARIA widget roles list.
      roles: Object.freeze([
        "button",
        "checkbox",
        "radio",
        "switch",
        "textbox",
        "searchbox",
        "combobox",
        "listbox",
        "spinbutton",
        "slider",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "tab",
      ]),
    }),
    TABLE: Object.freeze({
      alwaysBlur: Object.freeze(["caption"]),
      textCheck: Object.freeze(["td", "th"]),
    }),
    STRUCTURE: Object.freeze({
      alwaysBlur: Object.freeze([]),
      textCheck: Object.freeze([
        "div",
        "section",
        "article",
        "aside",
        "header",
        "footer",
        "figure",
        "details",
        "dialog",
        "li",
        "dt",
        "dd",
      ]),
    }),
  });

  const DEFAULT_CATS = blsi.DEFAULT_SETTINGS.BLUR_CATEGORIES;
  const CATEGORY_ORDER = Object.freeze([
    "TEXT",
    "MEDIA",
    "STRUCTURE",
    "FORM",
    "TABLE",
  ]);

  // ── cache ─────────────────────────────────────────────────────────

  let selectorCache = null;

  function buildSelectors(categories) {
    const alwaysBlurTags = [];
    const textCheckTags = [];
    const roles = [];

    for (const name of CATEGORY_ORDER) {
      if (!categories[name]) continue;
      const cat = CATEGORY_SELECTORS[name];
      for (let i = 0; i < cat.alwaysBlur.length; i++)
        alwaysBlurTags.push(cat.alwaysBlur[i]);
      for (let i = 0; i < cat.textCheck.length; i++)
        textCheckTags.push(cat.textCheck[i]);
      // Role coverage is per-category (currently FORM only). Roles match
      // elements regardless of their tag name via CSS attribute selectors,
      // so an element like <div role="button"> gets picked up by FORM.
      if (cat.roles) {
        for (let i = 0; i < cat.roles.length; i++) roles.push(cat.roles[i]);
      }
    }

    const tagSet = new Set(alwaysBlurTags);
    for (let i = 0; i < textCheckTags.length; i++) tagSet.add(textCheckTags[i]);
    const roleSet = new Set(roles);

    // Role attribute selectors append to the alwaysBlur CSS rule — ARIA role
    // matches are treated as "always blur" (no text gate) since a semantic
    // button / checkbox / slider carries interaction state, not empty text.
    const roleSelectorPart = roles.map((r) => `[role="${r}"]`).join(",");
    const alwaysBlurSelector = [alwaysBlurTags.join(","), roleSelectorPart]
      .filter((s) => s.length > 0)
      .join(",");

    const key = CATEGORY_ORDER.map((n) => (categories[n] ? "1" : "0")).join("");

    return {
      key,
      alwaysBlurSelector,
      textCheckSelector: textCheckTags.join(","),
      alwaysBlurTags,
      textCheckTags,
      tagSet,
      roleSet,
    };
  }

  function getSelectors(categories) {
    const key = CATEGORY_ORDER.map((n) => (categories[n] ? "1" : "0")).join("");
    if (selectorCache && selectorCache.key === key) return selectorCache;
    selectorCache = buildSelectors(categories);
    return selectorCache;
  }

  /** Set of text-check tag names for O(1) lookup in MO callback */
  let _textCheckSet = new Set();

  function _rebuildTextCheckSet(categories) {
    _textCheckSet = new Set();
    const cats = categories || DEFAULT_CATS;
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
  const _structuralTags = new Set(CATEGORY_SELECTORS.STRUCTURE.textCheck);
  // ── Private helpers ────────────────────────────────────────────────────────

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

  // ── SVG filter injection (frosted glass mode) ──────────────────────────────

  function _readCssRadius() {
    const v = document.documentElement.style
      .getPropertyValue("--bl-si-radius")
      .trim();
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function ensureSvgFilter() {
    // blurAll can fire before <body> is mounted (early document_idle edge case) —
    // appendChild(null) would throw. injectBlurRules is called on every page-wide
    // reconcile, so the filter gets re-created as soon as body exists.
    if (!document.body) return;
    // Always rebuild: mutating feGaussianBlur stdDeviation in place does not
    // reliably invalidate Chrome's filter cache, so callers rely on a fresh
    // element being injected whenever radius / mode changes.
    const existing = document.getElementById(SVG_FILTER_ID);
    if (existing && existing.parentNode)
      existing.parentNode.removeChild(existing);

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("id", SVG_FILTER_ID);
    svg.setAttribute("style", "position:absolute;width:0;height:0");

    const filter = document.createElementNS(svgNS, "filter");
    filter.setAttribute("id", "bl-si-frosted-filter");

    const turbulence = document.createElementNS(svgNS, "feTurbulence");
    turbulence.setAttribute("type", "turbulence");
    turbulence.setAttribute("baseFrequency", "0.04");
    turbulence.setAttribute("numOctaves", "3");
    turbulence.setAttribute("result", "noise");

    const displacement = document.createElementNS(svgNS, "feDisplacementMap");
    displacement.setAttribute("in", "SourceGraphic");
    displacement.setAttribute("in2", "noise");
    displacement.setAttribute("scale", "12");
    displacement.setAttribute("xChannelSelector", "R");
    displacement.setAttribute("yChannelSelector", "G");

    const gaussianBlur = document.createElementNS(svgNS, "feGaussianBlur");
    gaussianBlur.setAttribute("stdDeviation", String(_readCssRadius() || 4));

    filter.appendChild(turbulence);
    filter.appendChild(displacement);
    filter.appendChild(gaussianBlur);
    svg.appendChild(filter);

    document.body.appendChild(svg);
  }

  // ── CSS Rule Injection (always-blur tags) ──────────────────────────────────

  let _styleEl = null;

  // Extension UI exclusion — prevents our own toolbar/toast/filter from being blurred.
  // The frosted-filter SVG (#bl-si-svg-filters) must be excluded because adding svg
  // to MEDIA alwaysBlur means the CSS rule `svg:not(...)` would otherwise match our
  // own hidden filter definition SVG and apply blur to it. Visually harmless (0×0
  // element), but unclean — and could theoretically interfere with the filter if
  // Chrome invalidates paint-server references on blurred host elements.
  const EXCLUDE =
    ":not(#bl-si-picker-toolbar):not(#bl-si-picker-toolbar *)" +
    ":not(.bl-si-toast):not(.bl-si-toast *)" +
    ":not(.bl-si-toolbar):not(.bl-si-toolbar *)" +
    ":not(#" + SVG_FILTER_ID + ")";

  /**
   * Inject CSS rules for blur-all mode in DOM.
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

    const filterValue =
      mode === blsi.BLUR_MODES.FROSTED
        ? "url(#bl-si-frosted-filter)"
        : "blur(var(--bl-si-radius, 10px))";

    // transition: filter is declared alongside the filter itself so hover/click
    // reveal (reveal_controller sets inline `filter: none !important`) animates
    // smoothly in both directions. Initial blur-all apply/remove still snaps
    // because the rule itself appears/disappears in the same style recalc as
    // the filter value change — CSS transitions require the transition property
    // to be in effect before the animated property changes.
    const blurDecl =
      `filter: ${filterValue} !important; ` +
      `transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ` +
      `user-select: none !important;`;

    const rules = [];

    // Always-blur tags via CSS — auto-applies to present + future elements
    if (alwaysBlurSelector) {
      const excluded = alwaysBlurSelector
        .split(",")
        .map((t) => t.trim() + EXCLUDE)
        .join(",");
      rules.push(`${excluded} { ${blurDecl} }`);
    }

    // Data attribute rule — for text-check elements and individual picker blurs
    rules.push(`[data-bl-si-blur] { ${blurDecl} }`);

    if (rules.length === 0) return;

    _styleEl = document.createElement("style");
    _styleEl.id = STYLE_ID;
    _styleEl.textContent = rules.join("\n");
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

  // ── Text-check element blur (scan + MO for new nodes) ─────────────────────

  /**
   * Scan existing text-check elements and stamp `data-bl-si-blur` on those
   * matching the active categories. Called from `_enablePageWide` during
   * every page-wide reconcile. New DOM nodes (SPA rerenders, infinite
   * scroll) are handled per-node by the MutationObserver via `tryBlurTextCheck`.
   */
  function blurTextCheckElements(categories, thorough) {
    const { textCheckSelector } = getSelectors(categories || DEFAULT_CATS);
    if (!textCheckSelector) return;

    document.querySelectorAll(textCheckSelector).forEach((el) => {
      if (el.dataset.blSiBlur) return; // already stamped
      if (_isExtensionUI(el)) return;
      // Structural containers (div, section, etc.) always require the text gate —
      // blurring wrappers creates nested blur that breaks hover reveal.
      // Thorough mode only bypasses the gate for inline content elements.
      const needsTextGate = _structuralTags.has(el.tagName.toLowerCase());
      if (needsTextGate) {
        if (hasMeaningfulTextContent(el)) el.dataset.blSiBlur = "1";
      } else if (thorough || hasMeaningfulTextContent(el)) {
        el.dataset.blSiBlur = "1";
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
      if (hasMeaningfulTextContent(element)) element.dataset.blSiBlur = "1";
    } else if (thorough || hasMeaningfulTextContent(element)) {
      element.dataset.blSiBlur = "1";
    }
  }

  function _isExtensionUI(element) {
    const toolbarId = blsi.IDS.PICKER_TOOLBAR;
    return (
      element.id === toolbarId ||
      element.closest("#" + toolbarId) ||
      element.classList.contains(blsi.CSS.TOAST) ||
      element.closest("." + blsi.CSS.TOAST) ||
      element.classList.contains(blsi.CSS.TOOLBAR) ||
      element.dataset.blSiZone !== undefined
    );
  }

  // ── Individual element blur (picker / context menu) ────────────────────────

  function applyBlur(element) {
    if (!element || !(element instanceof Element)) return;
    if (element.dataset.blSiBlur) return;
    if (_isExtensionUI(element)) return;
    element.dataset.blSiBlur = "1";
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
    if (element.dataset.blSiBlur) return true;
    if (isBlurAllActive() && selectorCache) {
      const tag = element.tagName.toLowerCase();
      for (let i = 0; i < selectorCache.alwaysBlurTags.length; i++) {
        if (selectorCache.alwaysBlurTags[i] === tag) return true;
      }
      if (selectorCache.roleSet && selectorCache.roleSet.size > 0) {
        const role = element.getAttribute("role");
        if (role != null && selectorCache.roleSet.has(role)) return true;
      }
    }
    return false;
  }

  function unblurAll() {
    removeBlurRules();
    document.querySelectorAll("[data-bl-si-blur]").forEach((el) => {
      delete el.dataset.blSiBlur;
    });
    removeAllZoneOverlays();
  }

  function matchesActiveCategories(element, categories) {
    if (!element || !(element instanceof Element)) return false;
    const cats = categories || DEFAULT_CATS;
    const { tagSet, roleSet } = getSelectors(cats);
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
    const { roleSet } = getSelectors(cats);
    if (roleSet.size > 0) {
      const role = element.getAttribute("role");
      if (role != null && roleSet.has(role)) return true;
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

    const el = document.createElement("div");
    el.className = blsi.CSS.ZONE_OVERLAY;
    el.dataset.blSiZone = zoneData.id;
    el.dataset.blSiZoneName = zoneData.name || "";

    // Anchor: 'page' (default, absolute positioning in document coordinates
    // — zone scrolls with content) vs 'screen' (position: fixed in viewport
    // coordinates — zone stays put during scroll, ideal for always-on
    // screen-share privacy overlays).
    const anchor = zoneData.anchor === "screen" ? "screen" : "page";
    el.dataset.blSiZoneAnchor = anchor;

    const position = anchor === "screen" ? "fixed" : "absolute";
    el.style.cssText =
      [
        "position: " + position,
        "left: " + zoneData.x + "px",
        "top: " + zoneData.y + "px",
        "width: " + zoneData.width + "px",
        "height: " + zoneData.height + "px",
      ].join("; ") + ";";

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

  // ── High-level controller state (blur-all + item dispatch) ────────────────
  // Consolidated from the former content_script orchestrator so the engine
  // owns the full blur lifecycle — low-level primitives above are now the
  // private utilities of the wrappers below.

  let _isPageBlurred = false;
  let _domObserver = null;
  let _dynamicCounter = 0;
  let _stickyCounter = 0;
  let _pickerActive = false;
  let _currentSettings = null;

  // Tracks items currently applied to the DOM, keyed by item id
  // (dynamic → selector, sticky → id). Diffed against storage on every
  // blurAll() call to reconcile add/remove.
  const _activeItems = new Map();

  // Fingerprint of the last inputs that drove a page-wide _enablePageWide.
  // Lets blurAll() skip the nuke+rescan when only BLUR_RADIUS / HIGHLIGHT_COLOR
  // change (those propagate via CSS vars and don't need DOM work). Frosted
  // mode is the exception — its radius lives in an SVG attribute and needs
  // a filter rebuild, so BLUR_RADIUS is folded into the key under frosted.
  let _lastReconcileKey = null;

  function _itemId(item) {
    return item && item.type === "dynamic" ? item.selector : item && item.id;
  }

  function _applyDynamicItem(item) {
    try {
      const el = blsi.SelectorUtils.restoreSelector(item.selector);
      if (el) applyBlur(el);
    } catch (_e) {
      /* invalid selector */
    }
    const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
    if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
  }

  function _removeDynamicItem(item) {
    try {
      const el = blsi.SelectorUtils.restoreSelector(item.selector);
      if (el) removeBlur(el);
    } catch (_e) {
      /* invalid selector */
    }
  }

  function _applyStickyItem(item) {
    // Anchor determines coordinate system:
    //   'page'   — document coordinates, scrolls with content. Supports
    //              path-scoping and xPct/yPct re-projection on layout changes.
    //   'screen' — viewport coordinates, position: fixed. Applies on every
    //              page regardless of path; raw x/y are stable across pages.
    const anchor = item.anchor === "screen" ? "screen" : "page";

    if (anchor === "page" && item.path) {
      const stored = item.path.replace(/\/+$/, "") || "/";
      const current = location.pathname.replace(/\/+$/, "") || "/";
      if (stored !== current) return;
    }

    let x, y, w, h;
    if (anchor === "page") {
      // Re-project from percentages if available (handles layout changes
      // between the capture page and the current render).
      const curW = document.documentElement.scrollWidth || window.innerWidth;
      const curH = document.documentElement.scrollHeight || window.innerHeight;
      x = typeof item.xPct === "number" ? item.xPct * curW : item.x;
      y = typeof item.yPct === "number" ? item.yPct * curH : item.y;
      w = typeof item.widthPct === "number" ? item.widthPct * curW : item.width;
      h = typeof item.heightPct === "number" ? item.heightPct * curH : item.height;
    } else {
      // Screen-anchored: raw pixel coordinates in the viewport. No re-projection.
      x = item.x;
      y = item.y;
      w = item.width;
      h = item.height;
    }

    createZoneOverlay({
      id: item.id,
      name: item.name,
      anchor: anchor,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
    });

    const num = parseInt((item.name || "").replace("Sticky ", ""), 10);
    if (!isNaN(num) && num > _stickyCounter) _stickyCounter = num;
  }

  function _removeStickyItem(item) {
    removeZoneOverlay(item.id);
  }

  function applyItem(item) {
    if (!item) return;
    if (item.type === "dynamic") _applyDynamicItem(item);
    else if (item.type === "sticky") _applyStickyItem(item);
  }

  function removeItem(item) {
    if (!item) return;
    if (item.type === "dynamic") _removeDynamicItem(item);
    else if (item.type === "sticky") _removeStickyItem(item);
  }

  function resetCounters() {
    _dynamicCounter = 0;
    _stickyCounter = 0;
  }

  function allocateDynamicName() {
    _dynamicCounter++;
    return "Dynamic " + _dynamicCounter;
  }

  function allocateStickyName() {
    _stickyCounter++;
    return "Sticky " + _stickyCounter;
  }

  function _startDomObserver() {
    if (!document.body) return;
    if (_domObserver) return;
    _domObserver = new MutationObserver((mutations) => {
      if (_pickerActive) return;
      if (!_isPageBlurred) return;
      const thorough = _currentSettings
        ? !!_currentSettings.THOROUGH_BLUR
        : false;
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.dataset && node.dataset.blSiZone !== undefined) continue;
          tryBlurTextCheck(node, thorough);
          const children = node.querySelectorAll("*");
          for (let i = 0; i < children.length; i++) {
            tryBlurTextCheck(children[i], thorough);
          }
        }
      }
    });
    _domObserver.observe(document.body, { childList: true, subtree: true });
  }

  function _stopDomObserver() {
    if (_domObserver) {
      _domObserver.disconnect();
      _domObserver = null;
    }
  }

  function _enablePageWide(settings) {
    const cats = settings.BLUR_CATEGORIES || DEFAULT_CATS;
    const mode = settings.BLUR_MODE || null;
    const thorough = !!settings.THOROUGH_BLUR;
    removeBlurRules();
    // Clear all text-check stamps before re-scanning so that tightening
    // categories or disabling THOROUGH_BLUR actually removes elements that
    // no longer match. Picker items are re-stamped by the item reconcile
    // step in blurAll() right after this function returns.
    document.querySelectorAll("[data-bl-si-blur]").forEach((el) => {
      delete el.dataset.blSiBlur;
    });
    injectBlurRules(cats, mode);
    blurTextCheckElements(cats, thorough);
    _startDomObserver();
    _isPageBlurred = true;
  }

  function _disablePageWide() {
    _stopDomObserver();
    removeBlurRules();
    // Clear every data-bl-si-blur stamp. Picker items are re-stamped by
    // PHASE 4 of the same blurAll() call when they're still in storage.
    document.querySelectorAll("[data-bl-si-blur]").forEach((el) => {
      delete el.dataset.blSiBlur;
    });
    // Remove the frosted SVG filter if it was injected. Harmless to leave
    // behind, but keeps the DOM clean for users who toggle modes repeatedly.
    const svg = document.getElementById(SVG_FILTER_ID);
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    _isPageBlurred = false;
  }

  /**
   * Single reconciler: sync DOM state to the storage snapshot.
   *
   * Pulls settings, URL rules, per-host blur-all state, and per-host items
   * from Storage in parallel, then diffs against the current DOM state and
   * applies only the delta. Safe to call at any time from any path — init,
   * settings change, picker add/remove, shortcut toggle, SPA URL change.
   *
   * Zero args by design: storage is the single source of truth. Callers
   * write to storage first, then `await blurAll()` to materialise the change.
   * Every caller MUST await — fire-and-forget call sites let onChange events
   * interleave concurrent reconciles that corrupt `_activeItems`.
   */
  async function blurAll() {
    const Store = blsi.Storage;
    const UrlMatcher = blsi.UrlMatcher;
    if (!Store || !UrlMatcher) return;

    // ── PHASE 1: Fetch + resolve snapshot ────────────────────────────────────
    // Reads:    blsi.Storage (settings, rules, blur_all_state, blur_items), UrlMatcher
    // Mutates:  nothing (storage read only)
    // Invariant: on error, return early without touching any DOM state.
    const hostname = location.hostname;
    let rawSettings, rules, isActive, items;
    try {
      [rawSettings, rules, isActive, items] = await Promise.all([
        Store.getSettings(),
        Store.getRules(),
        Store.getBlurState(hostname),
        Store.getBlurItems(hostname),
      ]);
    } catch (_e) {
      return;
    }
    const settings = UrlMatcher.resolveSettings(
      location.href,
      rawSettings,
      rules,
    );

    // ── PHASE 2: ENABLED=false teardown ──────────────────────────────────────
    // Reads:    settings.ENABLED
    // Mutates:  _isPageBlurred, _activeItems, _lastReconcileKey, DOM (all stamps + overlays + SVG)
    // Invariant: on return, DOM has zero blur state regardless of prior state.
    if (settings.ENABLED === false) {
      if (_isPageBlurred) _disablePageWide();
      for (const [, item] of _activeItems) removeItem(item);
      _activeItems.clear();
      _lastReconcileKey = null;
      return;
    }
    _currentSettings = settings;

    // ── PHASE 3: Page-wide blur-all reconcile ────────────────────────────────
    // Reads:    isActive, _isPageBlurred, _lastReconcileKey
    // Mutates:  DOM (style rules, text-check stamps, SVG filter), _domObserver, _isPageBlurred
    // Invariant: after this block, _isPageBlurred === isActive. Cheap no-op
    //            when nothing page-wide changed since the last call (e.g. a
    //            BLUR_RADIUS drag in gaussian mode, which propagates via CSS vars).
    const reconcileKey = isActive
      ? `${settings.BLUR_MODE}|${JSON.stringify(settings.BLUR_CATEGORIES)}|${settings.THOROUGH_BLUR}|${settings.BLUR_MODE === blsi.BLUR_MODES.FROSTED ? settings.BLUR_RADIUS : ""}`
      : "inactive";
    const pageWideChanged = reconcileKey !== _lastReconcileKey;
    _lastReconcileKey = reconcileKey;

    if (isActive) {
      if (pageWideChanged || !_isPageBlurred) _enablePageWide(settings);
      // else: already active with same categories/mode/thorough — skip nuke.
    } else if (_isPageBlurred) {
      _disablePageWide();
    }

    // ── PHASE 4: Item reconcile (dynamic + sticky) ───────────────────────────
    // Reads:    items (from storage), _activeItems (current tracked set)
    // Mutates:  _activeItems, DOM (blur attributes, zone overlays)
    // Invariant: after this block, _activeItems keyset === desiredById keyset;
    //            every desired item has been re-applied (applyBlur and
    //            createZoneOverlay are idempotent, so re-apply is safe and
    //            necessary — PHASE 3's nuke may have cleared the stamp).
    const desired = Array.isArray(items) ? items : [];
    const desiredById = new Map(desired.map((i) => [_itemId(i), i]));

    let added = 0, removed = 0;
    for (const [id, item] of Array.from(_activeItems)) {
      if (!desiredById.has(id)) {
        removeItem(item);
        _activeItems.delete(id);
        removed++;
      }
    }
    for (const [id, item] of desiredById) {
      const isNew = !_activeItems.has(id);
      applyItem(item);
      _activeItems.set(id, item);
      if (isNew) added++;
    }

    if (blsi.Logger && blsi.Logger.enabled) {
      blsi.Logger.scope('engine').flow('blurAll', {
        pageActive: isActive,
        pageWideChanged,
        added,
        removed,
        totalActive: _activeItems.size,
      });
    }
  }

  function _setPickerActiveForObserver(v) {
    _pickerActive = !!v;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // Blur-all low-level primitives
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
    isVisuallyBlurred,
    matchesActiveCategories,
    shouldBlurElement,

    // Sticky zones
    createZoneOverlay,
    removeZoneOverlay,
    getZoneOverlays,
    removeAllZoneOverlays,

    // Utilities
    ensureSvgFilter,
    CATEGORY_SELECTORS,

    // Counter allocation for picker callbacks
    resetCounters,
    allocateDynamicName,
    allocateStickyName,

    // Single orchestration entry point: reconcile DOM to Storage snapshot.
    blurAll,
    get isPageBlurred() {
      return _isPageBlurred;
    },
    _setPickerActiveForObserver,
  };
})();

blsi.BlurEngine = BlurEngine;
