/**
 * core/css_manager.js — CSS rule injection for the blur engine.
 *
 * Three independent injection systems share this file because they all
 * synthesise <style> blocks that participate in the same cascade:
 *
 *   - blur-all rules    (#bl-si-blur-styles)        injectRules / removeRules
 *   - pick-blur rules   (#bl-si-pick-blur-styles)   injectPickBlurRules / removePickBlurRules
 *   - PII rules         (#bl-si-pii-styles)         injectPiiRules / removePiiRules
 *
 * Also owns the always-blur SVG filter (frosted glass) and the selector cache
 * that buildSelectors / getSelectors compose from blsi.Categories data.
 *
 * Cross-module calls at runtime:
 *   - injectRules() → blsi.MarkerEngine.rebuildTextCheckSet(cats) — keeps the
 *     marker engine's text-check tag set in sync after a category change.
 *     Manifest order guarantees MarkerEngine is loaded before any handleSite
 *     call, which is the only path that drives injectRules.
 *
 * Exposed as blsi.CssManager (IIFE — no ES module syntax).
 */

const BlurrySiteCssManager = (() => {
  'use strict';

  const SVG_FILTER_ID = blsi.ids.svg_filters;
  const STYLE_ID      = "bl-si-blur-styles";
  const PICK_STYLE_ID = "bl-si-pick-blur-styles";
  const PII_STYLE_ID  = "bl-si-pii-styles";

  const CATEGORY_SELECTORS = blsi.Categories.CATEGORY_SELECTORS;
  const CATEGORY_ORDER     = blsi.Categories.CATEGORY_ORDER;
  const DEFAULT_CATS       = blsi.Categories.DEFAULT_CATS;

  // ── Selector cache + builder ───────────────────────────────────────────────

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

  // Read-only accessor — used by marker_engine.isBlurred / isVisuallyBlurred
  // to inspect the most recently used cache entry without triggering a rebuild.
  function getLastSelectorCache() {
    return selectorCache;
  }

  // ── SVG filter injection (frosted glass mode) ──────────────────────────────

  function _readCssRadius() {
    const v = document.documentElement.style
      .getPropertyValue("--bl-si-radius")
      .trim();
    const n = parseFloat(v);
    // 0 is a valid "no blur" value — only reject NaN / negative / missing.
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function ensureSvgFilter(root) {
    // injectRules can fire before <body> is mounted (early document_idle edge case) —
    // appendChild(null) would throw. injectRules is called on every page-wide
    // reconcile, so the filter gets re-created as soon as the container exists.
    // For shadow roots, root.body is undefined so root itself is the container.
    const container = (root && root !== document) ? root : document.body;
    if (!container) return;
    // Always rebuild: mutating feGaussianBlur stdDeviation in place does not
    // reliably invalidate Chrome's filter cache, so callers rely on a fresh
    // element being injected whenever radius / mode changes.
    const existing = container.querySelector('#' + SVG_FILTER_ID);
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
    // Fallback 4 only when the var is missing / invalid; 0 is honoured.
    const radius = _readCssRadius();
    gaussianBlur.setAttribute("stdDeviation", String(radius !== null ? radius : 4));

    filter.appendChild(turbulence);
    filter.appendChild(displacement);
    filter.appendChild(gaussianBlur);
    svg.appendChild(filter);

    container.appendChild(svg);
  }

  // ── CSS Rule Injection (always-blur tags) ──────────────────────────────────

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
    ":not(#" + SVG_FILTER_ID + ")" +
    ":not([data-bl-si-reveal])" +
    ":not([data-bl-si-pick-blur])" +
    ":not([data-bl-si-pii])";

  /**
   * Inject CSS rules for blur-all mode into `root` (document or shadow root).
   * Always-blur tags get tag-based CSS selectors; data-attribute rule covers
   * text-check and picker elements. Idempotent — removes prior style first.
   *
   * Stateless injection target: `root.head ?? root`
   *   - document: styles go to <head>
   *   - shadowRoot: shadowRoot.head is undefined → styles go directly into the root
   */
  function injectRules(root, categories, mode) {
    removeRules(root);

    // Frosted glass: inject SVG filter into the same root so url(#id)
    // resolves correctly within that root's scope.
    if (mode === blsi.blur_modes.frosted) ensureSvgFilter(root);

    const cats = categories || DEFAULT_CATS;
    const { alwaysBlurSelector } = getSelectors(cats);

    // Marker-engine maintains a text-check tag set used by the MutationObserver
    // path. Keep it in sync whenever blur-all rules change.
    blsi.MarkerEngine.rebuildTextCheckSet(cats);

    // CSS var dependency: --bl-si-radius is set by the engine before
    // injectRules runs. Changing BLUR_RADIUS in gaussian mode propagates
    // instantly via the CSS var without a page-wide nuke — the engine's
    // reconcileKey deliberately excludes BLUR_RADIUS for gaussian.
    // For shadow roots, --bl-si-radius is inherited from :root.
    const isRedacted = mode === blsi.blur_modes.redacted;
    const isMasked   = mode === blsi.blur_modes.censored;

    let blurDecl;
    if (isRedacted) {
      // filter: none cancels the static content.css gaussian rule for [data-bl-si-blur]
      // elements (textCheck + picker), so only the redaction colour shows.
      blurDecl =
        `background-color: var(--bl-si-redaction-color, #000) !important; ` +
        `color: transparent !important; ` +
        `border-color: var(--bl-si-redaction-color, #000) !important; ` +
        `text-decoration-color: transparent !important; ` +
        `filter: none !important; ` +
        `user-select: none !important;`;
    } else if (isMasked) {
      // Font replacement: every character renders as a filled disc glyph (●).
      // filter: none cancels the static content.css gaussian rule.
      blurDecl =
        `font-family: "bl-si-censored-disc" !important; ` +
        `filter: none !important; ` +
        `user-select: none !important;`;
    } else {
      const filterValue =
        mode === blsi.blur_modes.frosted
          ? "url(#bl-si-frosted-filter)"
          : "blur(var(--bl-si-radius, 10px))";
      // transition: filter is declared alongside the filter itself so hover/click
      // reveal (reveal_controller sets inline `filter: none !important`) animates
      // smoothly in both directions.
      blurDecl =
        `filter: ${filterValue} !important; ` +
        `transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ` +
        `user-select: none !important;`;
    }

    const rules = [];

    if (isMasked) rules.push(blsi.Fonts.DISC_FONT_FACE);

    // Always-blur tags via CSS — auto-applies to present + future elements
    if (alwaysBlurSelector) {
      const excluded = alwaysBlurSelector
        .split(",")
        .map((t) => t.trim() + EXCLUDE)
        .join(",");
      rules.push(`${excluded} { ${blurDecl} }`);
    }

    // Data attribute rule — for text-check elements and individual picker blurs.
    // :not([data-bl-si-reveal]) excludes revealed elements so page CSS shows through
    // naturally — no cascade fight, no revert overrides needed in the reveal rule.
    rules.push(`[data-bl-si-blur]:not([data-bl-si-reveal]) { ${blurDecl} }`);

    // Media elements in redacted/masked modes need extra rules:
    // - Redacted: visibility:hidden hides image content so the background-color
    //   (already in blurDecl) shows through in the user's chosen redaction colour.
    //   brightness(0) always produced black regardless of --bl-si-redaction-color.
    // - Masked: brightness(0) makes media black (font-family replacement has no effect on image content).
    if (isRedacted || isMasked) {
      const mediaTags = ["img", "video", "canvas", "svg", "picture", "audio"];
      const mediaDecl = isRedacted
        ? "visibility: hidden !important; user-select: none !important;"
        : "filter: brightness(0) !important; user-select: none !important;";
      rules.push(`${mediaTags.map(t => t + "[data-bl-si-blur]:not([data-bl-si-reveal])").join(",")} { ${mediaDecl} }`);
      // Exact-match against the cache's tag list — substring matching here
      // would silently false-match if a future media tag were a substring
      // of another (e.g. 'vid' inside 'video').
      const cache = getSelectors(cats);
      if (cache.alwaysBlurTags.length) {
        const alwaysSet = new Set(cache.alwaysBlurTags);
        const mediaSel = mediaTags
          .filter(t => alwaysSet.has(t))
          .map(t => t + EXCLUDE)
          .join(",");
        if (mediaSel) rules.push(`${mediaSel} { ${mediaDecl} }`);
      }
    }

    // Reveal overrides — also declared in styles/content.css, but BOTH are needed:
    // - static content.css handles reveal when blur-all is OFF (picker/individual blurs only,
    //   no injected <style> exists).
    // - these injected rules handle reveal when blur-all is ON. The injected <style> is
    //   appended to <head> after content.css, so when both have !important at equal
    //   specificity, source order decides — the static reveal rule would LOSE to the
    //   injected blur rules above it. Pushing reveal here places it after the blur rules
    //   in the same stylesheet, so it wins.
    // For shadow roots, these overrides are equally required so that reveal works
    // on elements inside the shadow tree.
    // visibility:hidden is used for media in redacted mode — must be reset on reveal.
    rules.push(`[data-bl-si-reveal] { filter: none !important; visibility: visible !important; font-family: unset !important; transition: filter var(--bl-si-transition-duration, 150ms) ease !important; user-select: auto !important; }`);
    // Cascade reveal to blurred children of a revealed ancestor.
    // When revealAncestorChain stamps data-bl-si-reveal on a parent (e.g. <p>),
    // sibling [data-bl-si-blur] children inside it would still paint their own
    // filter: blur() — child filter wins over the parent's filter: none. This
    // descendant rule clears those children, preventing blurred "islands" inside
    // a revealed ancestor. Also declared in content.css for the static (blur-all
    // OFF) case; both copies are needed for source-order correctness.
    rules.push(`[data-bl-si-reveal] [data-bl-si-blur] { filter: none !important; user-select: auto !important; }`);
    rules.push(`[data-bl-si-reveal] [data-bl-si-pick-blur] { filter: none !important; background-color: transparent !important; color: inherit !important; font-family: unset !important; user-select: auto !important; }`);
    rules.push(`[data-bl-si-reveal] [data-bl-si-pii] { filter: none !important; user-select: auto !important; }`);

    if (rules.length === 0) return;

    const styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = rules.join("\n");
    (root.head ?? root).appendChild(styleEl);
  }

  function removeRules(root) {
    const container = root.head ?? root;
    const el = container.querySelector && container.querySelector('#' + STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function isBlurAllActive() {
    return !!(document.head && document.head.querySelector('#' + STYLE_ID));
  }

  // ── Pick & Blur mode injection ─────────────────────────────────────────────

  function _colorToRgba(color) {
    if (!color || !color.hex) return 'rgba(0,0,0,1)';
    const hex = color.hex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = typeof color.opacity === 'number' ? color.opacity : 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function removePickBlurRules(root) {
    const container = root.head ?? root;
    const el = container.querySelector && container.querySelector('#' + PICK_STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectPickBlurRules(root, type, color) {
    removePickBlurRules(root);
    // blur: static content.css rule handles [data-bl-si-pick-blur] already
    if (!type || type === blsi.pick_blur_modes.blur) return;

    const rules = [];
    const notRevealed = '[data-bl-si-pick-blur]:not([data-bl-si-reveal])';
    const revealSel   = '[data-bl-si-pick-blur][data-bl-si-reveal]';

    if (type === blsi.pick_blur_modes.frosted) {
      ensureSvgFilter(root);
      rules.push(
        notRevealed + ' { ' +
        'filter: url(#bl-si-frosted-filter) !important; ' +
        'transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ' +
        'user-select: none !important; }'
      );
      rules.push(revealSel + ' { filter: none !important; }');

    } else if (type === blsi.pick_blur_modes.color) {
      const rgba = _colorToRgba(color);
      rules.push(
        '[data-bl-si-pick-blur]:not(.bl-si-zone-overlay):not([data-bl-si-reveal]) { ' +
        'background-color: ' + rgba + ' !important; ' +
        'color: transparent !important; ' +
        'filter: none !important; ' +
        'user-select: none !important; }'
      );
      rules.push(
        '.bl-si-zone-overlay[data-bl-si-pick-blur]:not([data-bl-si-reveal]) { ' +
        'backdrop-filter: none !important; ' +
        '-webkit-backdrop-filter: none !important; ' +
        'background: ' + rgba + ' !important; ' +
        'border: none !important; }'
      );
      rules.push(
        revealSel + ' { ' +
        'background-color: transparent !important; ' +
        'color: inherit !important; ' +
        'filter: none !important; ' +
        'user-select: auto !important; }'
      );
    }

    if (!rules.length) return;
    const styleEl = document.createElement('style');
    styleEl.id = PICK_STYLE_ID;
    styleEl.textContent = rules.join('\n');
    (root.head ?? root).appendChild(styleEl);
  }

  // ── PII rule injection (CSS-only — detector logic is in src/pii_detector.js) ──

  function removePiiRules() {
    const el = document.head && document.head.querySelector('#' + PII_STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectPiiRules(mode, color) {
    removePiiRules();
    if (!document.head) return;

    const piiSel = `[data-bl-si-pii]:not([data-bl-si-reveal])`;
    const isRedacted   = mode === blsi.pii_modes.redacted;
    const isAsterisked = mode === blsi.pii_modes.starred;
    const isFrosted    = mode === blsi.pii_modes.frosted;

    if (isFrosted) ensureSvgFilter(document);

    let blurDecl;
    if (isRedacted) {
      const c = (color && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : 'var(--bl-si-redaction-color, #000)';
      blurDecl =
        `background-color: ${c} !important; ` +
        `color: transparent !important; ` +
        `border-color: ${c} !important; ` +
        `text-decoration-color: transparent !important; ` +
        `filter: none !important; ` +
        `user-select: none !important;`;
    } else if (isAsterisked) {
      // Font replacement: every character renders as a 6-arm asterisk glyph.
      blurDecl =
        `font-family: "bl-si-starred-asterisk" !important; ` +
        `filter: none !important; ` +
        `user-select: none !important;`;
    } else {
      const filterValue = isFrosted
        ? `url(#bl-si-frosted-filter)`
        : `blur(12px)`;
      blurDecl =
        `filter: ${filterValue} !important; ` +
        `transition: filter var(--bl-si-transition-duration, 150ms) ease !important; ` +
        `user-select: none !important;`;
    }

    const rules = [];

    if (isAsterisked) rules.push(blsi.Fonts.ASTERISK_FONT_FACE);

    rules.push(`${piiSel} { ${blurDecl} }`);

    // Reveal overrides — must come after blur rules (source-order wins for !important at equal specificity).
    rules.push(`[data-bl-si-reveal] [data-bl-si-pii] { filter: none !important; font-family: unset !important; color: unset !important; background-color: unset !important; user-select: auto !important; }`);

    const styleEl = document.createElement("style");
    styleEl.id = PII_STYLE_ID;
    styleEl.textContent = rules.join("\n");
    document.head.appendChild(styleEl);
  }

  return {
    // Read by orchestrator teardown to find the SVG filter element to remove.
    SVG_FILTER_ID,

    // Selector cache
    getSelectors,
    getLastSelectorCache,

    // SVG filter
    ensureSvgFilter,

    // Blur-all CSS
    injectRules,
    removeRules,
    isBlurAllActive,

    // Pick-blur CSS
    injectPickBlurRules,
    removePickBlurRules,

    // PII CSS
    injectPiiRules,
    removePiiRules,
  };
})();

blsi.CssManager = BlurrySiteCssManager;
