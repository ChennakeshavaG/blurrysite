/**
 * blur_engine.js — Blurry Site Core Blur Engine
 *
 * Hybrid CSS + data-attribute blur system:
 *  - CSS Style Cases -> Always-blur tags (h1, p, img, etc.) → injected <style> with tag selectors
 *  - DOM Mutation Observer Cases ->Text-check tags (div, span, li, etc.) → data-bl-si-blur attribute.
 *  - Picker/context menu → data-bl-si-pick-blur on individual elements (sole attribute; separate from blur-all)
 *
 * Uses attributes instead of class based to avoid issues from redering frameworks which primarly work on class changes (React, Vue .,etc)
 * This Attribute approach makes the blurring less susceptible to website functionality breakagaes
 *
 * Exposed as blsi.BlurEngine (IIFE — no ES module syntax).
 */

const BlurEngine = (() => {
  "use strict";

  const SVG_FILTER_ID = blsi.ids.svg_filters;
  const STYLE_ID      = "bl-si-blur-styles";
  const PICK_STYLE_ID = "bl-si-pick-blur-styles";

  // ── Category selector definitions ──────────────────────────────────────────

  const CATEGORY_SELECTORS = Object.freeze({
    text: Object.freeze({
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
    media: Object.freeze({
      alwaysBlur: Object.freeze(["img", "video", "audio", "canvas", "svg"]),
      textCheck: Object.freeze([]),
    }),
    form: Object.freeze({
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
    table: Object.freeze({
      alwaysBlur: Object.freeze(["caption"]),
      textCheck: Object.freeze(["td", "th"]),
    }),
    structure: Object.freeze({
      // li/dt/dd moved to alwaysBlur so CSS injection covers ::marker pseudo-elements
      // unconditionally — JS text-gate on li was leaving ordinal markers visible.
      alwaysBlur: Object.freeze(["li", "dt", "dd"]),
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
      ]),
    }),
  });

  const DEFAULT_CATS = blsi.DEFAULT_MODEL.settings.blur_categories;

  const CATEGORY_ORDER = Object.freeze([
    "text",
    "media",
    "structure",
    "form",
    "table",
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
  const _structuralTags = new Set(CATEGORY_SELECTORS.structure.textCheck);
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
    gaussianBlur.setAttribute("stdDeviation", String(_readCssRadius() || 4));

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
    ":not([data-bl-si-reveal])";

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
    _rebuildTextCheckSet(cats);

    // CSS var dependency: --bl-si-radius is NOT set by the engine. The
    // caller (content_script.js applySettingsToDom()) owns setting it on
    // :root. In gaussian mode, changing BLUR_RADIUS propagates instantly
    // via the CSS var without needing a page-wide nuke — that's why the
    // reconcileKey deliberately excludes BLUR_RADIUS for gaussian. If
    // applySettingsToDom() is ever removed, blur radius changes will
    // silently stop working in gaussian mode.
    // For shadow roots, --bl-si-radius is inherited from :root, so the same
    // CSS var reference works without any extra propagation.
    const isRedacted = mode === blsi.blur_modes.redacted;
    const isMasked   = mode === blsi.blur_modes.masked;

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
        `font-family: "bl-si-redact-disc" !important; ` +
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

    if (isMasked && blsi.Fonts) rules.push(blsi.Fonts.DISC_FONT_FACE);

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
      const mediaTags = "img,video,canvas,svg,picture,audio";
      const mediaDecl = isRedacted
        ? "visibility: hidden !important; user-select: none !important;"
        : "filter: brightness(0) !important; user-select: none !important;";
      rules.push(`${mediaTags.split(",").map(t => t + "[data-bl-si-blur]:not([data-bl-si-reveal])").join(",")} { ${mediaDecl} }`);
      if (alwaysBlurSelector) {
        const mediaSel = mediaTags.split(",")
          .filter(t => alwaysBlurSelector.includes(t))
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
    rules.push(`[data-bl-si-reveal] { filter: none !important; visibility: visible !important; font-family: revert !important; transition: filter var(--bl-si-transition-duration, 150ms) ease !important; user-select: auto !important; }`);
    // Cascade reveal to blurred children of a revealed ancestor.
    // When revealAncestorChain stamps data-bl-si-reveal on a parent (e.g. <p>),
    // sibling [data-bl-si-blur] children inside it would still paint their own
    // filter: blur() — child filter wins over the parent's filter: none. This
    // descendant rule clears those children, preventing blurred "islands" inside
    // a revealed ancestor. Also declared in content.css for the static (blur-all
    // OFF) case; both copies are needed for source-order correctness.
    rules.push(`[data-bl-si-reveal] [data-bl-si-blur] { filter: none !important; user-select: auto !important; }`);
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

  const PII_STYLE_ID = "bl-si-pii-styles";

  function removePiiRules() {
    const el = document.head && document.head.querySelector('#' + PII_STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectPiiRules(mode, color) {
    removePiiRules();
    if (!document.head) return;

    const piiSel = `[data-bl-si-pii]:not([data-bl-si-reveal])`;
    const isRedacted   = mode === blsi.pii_modes.redacted;
    const isAsterisked = mode === blsi.pii_modes.asterisked;
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
        `font-family: "bl-si-redact-asterisk" !important; ` +
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

    if (isAsterisked && blsi.Fonts) rules.push(blsi.Fonts.ASTERISK_FONT_FACE);

    rules.push(`${piiSel} { ${blurDecl} }`);

    // Reveal overrides — must come after blur rules (source-order wins for !important at equal specificity).
    rules.push(`[data-bl-si-reveal] [data-bl-si-pii] { filter: none !important; font-family: revert !important; color: revert !important; background-color: revert !important; user-select: auto !important; }`);

    const styleEl = document.createElement("style");
    styleEl.id = PII_STYLE_ID;
    styleEl.textContent = rules.join("\n");
    document.head.appendChild(styleEl);
  }

  function isBlurAllActive() {
    return !!(document.head && document.head.querySelector('#' + STYLE_ID));
  }

  // ── Text-check element blur (scan + MO for new nodes) ─────────────────────

  /**
   * Scan elements in `root`, stamp `data-bl-si-blur` on text-check elements
   * matching the active categories, and collect any open shadow roots found
   * during the traversal — all in ONE querySelectorAll('*') pass.
   *
   * Returns the discovered ShadowRoot[] so the caller (handleDocument) can
   * dispatch into them after this root is fully processed. No shadowCb param —
   * the caller owns dispatch so shadow roots are never processed mid-loop.
   */
  function stampElements(root, categories, thorough, mode) {
    const cats = categories || DEFAULT_CATS;
    _rebuildTextCheckSet(cats);
    const isMasked = mode === blsi.blur_modes.masked;

    // Collect shadow roots piggybacked on the stamp pass — no extra traversal.
    const shadowRoots = [];

    root.querySelectorAll('*').forEach((el) => {
      // Shadow root discovery: collect for post-stamp dispatch by caller.
      // CSS injected into each shadow root handles alwaysBlur declaratively;
      // text-check stamping happens when caller recurses via handleDocument.
      if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

      const tag = el.tagName.toLowerCase();

      // Custom element host stamping — hyphenated tag names never land in
      // _textCheckSet (which only contains known HTML elements). Stamp the
      // host itself so light-DOM-only custom elements (e.g. <shreddit-foo>)
      // aren't invisible to blur. Shadow root content is handled separately
      // via handleDocument recursion. Gated on STRUCTURE or TEXT active.
      if (tag.includes('-')) {
        if (!el.dataset.blSiBlur && !_isExtensionUI(el) &&
            (cats.structure !== false || cats.text !== false) &&
            (thorough || hasMeaningfulTextContent(el))) {
          el.dataset.blSiBlur = '1';
        }
        return;
      }

      // Text-check stamping
      if (!_textCheckSet.has(tag)) return;
      if (el.dataset.blSiBlur) return; // already stamped
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
    if (element.dataset.blSiBlur) return;
    if (_isExtensionUI(element)) return;
    const tag = element.tagName.toLowerCase();
    if (!_textCheckSet.has(tag)) return;
    const needsTextGate = _structuralTags.has(tag);
    if (needsTextGate) {
      if (hasMeaningfulTextContent(element)) element.dataset.blSiBlur = "1";
    } else if (thorough || hasMeaningfulTextContent(element) ||
               !!(element.querySelector && element.querySelector('slot'))) {
      // slot check: dynamically added shadow DOM elements with <slot> descendants
      // render projected light-DOM content — stamp them even without direct text.
      element.dataset.blSiBlur = "1";
    }
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
    // gaussian: static content.css rule handles [data-bl-si-pick-blur] already
    if (!type || type === blsi.pick_blur_modes.gaussian) return;

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
        'filter: none !important; }'
      );
    }

    if (!rules.length) return;
    const styleEl = document.createElement('style');
    styleEl.id = PICK_STYLE_ID;
    styleEl.textContent = rules.join('\n');
    (root.head ?? root).appendChild(styleEl);
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
    delete element.dataset.blSiPickBlur;
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
    if (element.dataset.blSiBlur || element.dataset.blSiPickBlur) return true;
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
    if (element.dataset.blSiBlur || element.dataset.blSiPickBlur) return true;
    if (element.dataset.blSiPii) return true;  // PII spans have their own CSS rule
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

  // Public alias — used by picker callbacks and tests.
  // Delegates to teardown(document) once teardown is defined below.
  function unblurAll() {
    teardown(document);
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
    el.className = blsi.css.zone_overlay;
    el.dataset.blSiZone = zoneData.id;
    el.dataset.blSiZoneName = zoneData.name || "";

    // Anchor: 'page' (default, absolute positioning in document coordinates
    // — zone scrolls with content) vs 'screen' (position: fixed in viewport
    // coordinates — zone stays put during scroll, ideal for always-on
    // screen-share privacy overlays).
    const anchor = zoneData.anchor === "screen" ? "screen" : "page";
    el.dataset.blSiZoneAnchor = anchor;
    el.dataset.blSiPickBlur = '1';

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
  // WeakMap<root, MutationObserver> — one observer per active root (document + shadow roots).
  // WeakMap auto-GCs entries when a shadow root is GC'd (host removed from DOM).
  const _observers = new WeakMap();
  // Mutex — prevents concurrent handleSite() calls from interleaving DOM mutations.
  let _handling = false;
  let _dynamicCounter = 0;
  let _stickyCounter = 0;
  let _pickerActive = false;
  // Reserved for future tooltip-during-peek feature. Not currently used.
  // See commit history for the stamp-then-reveal approach that was reverted
  // because it created visual gaps on SPAs (WhatsApp: "Download for Mac"
  // section unblurred on load when cursor was positioned over it).
  // The correct approach likely needs a fundamentally different strategy
  // (e.g., CSS :has() to style tooltip siblings, or a site-specific
  // heuristic layer) rather than MO gating.
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
      if (el && !_isExtensionUI(el)) {
        el.dataset.blSiPickBlur = '1';
      }
    } catch (_e) {
      /* invalid selector */
    }
    const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
    if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
  }

  function _removeDynamicItem(item) {
    try {
      const el = blsi.SelectorUtils.restoreSelector(item.selector);
      if (el) delete el.dataset.blSiPickBlur;
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
      const curW = document.documentElement.scrollWidth || window.innerWidth;
      // Re-project X/width when viewport WIDTH has clearly changed (reflow).
      // Never re-project Y/height — page height varies during load (lazy images,
      // dynamic content) so curH at RESTORE time is unreliable; raw Y is exact.
      const wChanged = item.scrollWidth && Math.abs(curW - item.scrollWidth) > Math.max(10, item.scrollWidth * 0.01);
      x = (wChanged && typeof item.xPct === "number") ? item.xPct * curW : item.x;
      y = item.y;
      w = (wChanged && typeof item.widthPct === "number") ? item.widthPct * curW : item.width;
      h = item.height;
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

  /**
   * Register a MutationObserver on `root` to stamp new text-check elements
   * and activate shadow roots as they appear. Idempotent — no-op if `root`
   * already has an active observer.
   *
   * Observation target: `root.body ?? root`
   *   - document: observes document.body
   *   - shadowRoot: observes the shadow root itself (shadowRoot.body is undefined)
   */
  function observeRoot(root) {
    if (_observers.has(root)) return;
    const target = root.body ?? root;
    if (!target) return;

    const obs = new MutationObserver((mutations) => {
      if (_pickerActive || !_isPageBlurred) return;
      const thorough = _currentSettings ? !!_currentSettings.thorough_blur : false;
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.dataset && node.dataset.blSiZone !== undefined) continue;
          // Single pass: stamp text-check AND activate new shadow roots.
          // Guard: skip shadow roots that already have an observer — they were
          // activated by a prior handleDocument call and don't need re-processing.
          tryBlurTextCheck(node, thorough);
          if (node.shadowRoot && _currentSettings && !_observers.has(node.shadowRoot)) {
            handleShadowRoot(_currentSettings, node.shadowRoot); // fire-and-forget (async)
          }
          if (node.tagName === 'IFRAME' && _currentSettings) {
            handleIframe(_currentSettings, node);
          }
          const children = node.querySelectorAll('*');
          for (let i = 0; i < children.length; i++) {
            tryBlurTextCheck(children[i], thorough);
            if (children[i].shadowRoot && _currentSettings && !_observers.has(children[i].shadowRoot)) {
              handleShadowRoot(_currentSettings, children[i].shadowRoot); // fire-and-forget (async)
            }
            if (children[i].tagName === 'IFRAME' && _currentSettings) {
              handleIframe(_currentSettings, children[i]);
            }
          }
        }
      }
    });
    obs.observe(target, { childList: true, subtree: true });
    _observers.set(root, obs);
  }

  function disconnectObserver(root) {
    const obs = _observers.get(root);
    if (obs) {
      obs.disconnect();
      _observers.delete(root);
    }
  }

  /**
   * Remove all blur state from `root` and recursively from any open shadow
   * roots found within it. One pass: clear stamps + find shadow hosts.
   *
   * PII-stamped elements (data-bl-si-pii) are intentionally skipped —
   * they own their own blur lifecycle and must stay blurred when blur-all
   * turns off (matches the original _disablePageWide behaviour).
   */
  function teardown(root) {
    disconnectObserver(root);
    removeRules(root);
    removePickBlurRules(root);

    // ONE pass: clear stamps + collect shadow hosts for post-loop recursion.
    // Recursing inside forEach risks processing a child's shadow root before
    // the parent's stamps are cleared — collect-then-recurse avoids that.
    const shadowHosts = [];
    root.querySelectorAll('*').forEach(el => {
      if (el.dataset.blSiBlur && !el.dataset.blSiPii) {
        delete el.dataset.blSiBlur;
      }
      if (el.dataset.blSiPickBlur) {
        delete el.dataset.blSiPickBlur;
      }
      if (el.shadowRoot) shadowHosts.push(el);
    });

    // Remove SVG filter if present in this root (stateless — no-op if absent).
    const svg = root.querySelector && root.querySelector('#' + SVG_FILTER_ID);
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);

    // Recurse into shadow roots after this root is fully cleaned up.
    shadowHosts.forEach(h => teardown(h.shadowRoot));
  }

  /**
   * Apply or remove blur for the main document only.
   * Returns discovered ShadowRoot[] so handleSite can dispatch them.
   * _isPageBlurred is NOT set here — handleSite's responsibility.
   */
  async function handleMainDocument(settings) {
    const active = settings.enabled !== false && !!settings.blur_all_active;
    if (!active) {
      teardown(document);
      return [];
    }

    const cats = settings.blur_categories || DEFAULT_CATS;
    const mode = settings.blur_mode || null;
    const thorough = !!settings.thorough_blur;

    injectRules(document, cats, mode);
    document.querySelectorAll('[data-bl-si-blur]').forEach(el => {
      if (!el.dataset.blSiPii) { delete el.dataset.blSiBlur; }
    });
    const shadowRoots = stampElements(document, cats, thorough, mode);
    observeRoot(document);
    return shadowRoots;
  }

  /**
   * Apply or remove blur for one shadow root. Recurses into nested shadow roots.
   * _isPageBlurred is NOT set here — handleSite's responsibility.
   */
  async function handleShadowRoot(settings, shadowRoot) {
    const active = settings.enabled !== false && !!settings.blur_all_active;
    if (!active) {
      teardown(shadowRoot);
      return;
    }

    const cats = settings.blur_categories || DEFAULT_CATS;
    const mode = settings.blur_mode || null;
    const thorough = !!settings.thorough_blur;

    injectRules(shadowRoot, cats, mode);
    shadowRoot.querySelectorAll('[data-bl-si-blur]').forEach(el => {
      if (!el.dataset.blSiPii) { delete el.dataset.blSiBlur; }
    });
    const nested = stampElements(shadowRoot, cats, thorough, mode);
    observeRoot(shadowRoot);
    if (nested.length) {
      await Promise.all(nested.map(sr => handleShadowRoot(settings, sr)));
    }
  }

  /**
   * Stamp or unstamp a cross-origin <iframe> element as a blur black-box.
   * Same-origin iframes are skipped — all_frames:true gives them their own
   * content_script that handles blur independently.
   */
  function handleIframe(settings, iframeEl) {
    if (!iframeEl || _isExtensionUI(iframeEl)) return;
    const active = settings.enabled !== false && !!settings.blur_all_active;

    let isSameOrigin = false;
    try { isSameOrigin = !!iframeEl.contentDocument; } catch (_) {}
    if (isSameOrigin) return;

    if (active) {
      iframeEl.dataset.blSiBlur = '1';
    } else {
      delete iframeEl.dataset.blSiBlur;
    }
  }

  /**
   * Thin router — routes to handleMainDocument or handleShadowRoot.
   * Kept on the public API for backward compatibility and unit tests.
   */
  async function handleDocument(settings, root) {
    if (!root || root === document) return handleMainDocument(settings);
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
      return handleShadowRoot(settings, root);
  }

  /**
   * Diff `desired` items against `_activeItems` and apply/remove the delta.
   * Runs in both active and inactive paths — picker blurs and sticky zones
   * persist even when blur-all is off.
   */
  function _reconcileItems(desired) {
    const desiredArray = Array.isArray(desired) ? desired : [];
    const desiredById = new Map(desiredArray.map((i) => [_itemId(i), i]));

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
    return { added, removed };
  }

  /**
   * Single entry point — reconcile the entire page (document + all open shadow
   * roots) to the provided settings snapshot.
   *
   * Settings must include:
   *   BLUR_ALL_ACTIVE {boolean} — whether blur-all is on for this host
   *   BLUR_ITEMS      {Array}   — per-host blur items (dynamic + sticky)
   * Both are folded in by the caller (content_script._syncFromStorage) before calling.
   *
   * Storage reads live in content_script — handleSite is stateless/pure w.r.t.
   * storage. Every caller MUST await — concurrent calls are dropped (mutex).
   */
  async function handleSite(settings) {
    if (_handling) return;
    _handling = true;
    try {
      // Store FIRST — MO callback reads _currentSettings for new shadow hosts.
      _currentSettings = settings;

      // ── Extension disabled — full teardown including items ──────────────────
      if (settings.enabled === false) {
        handleMainDocument(settings);
        _isPageBlurred = false;
        _reconcileItems([]);
        removeAllZoneOverlays(); // safety net for orphaned zones
        _lastReconcileKey = null;
        return;
      }

      // ── Page-wide reconcile ─────────────────────────────────────────────────
      // Skip DOM work when only CSS vars changed (blur_radius in gaussian mode,
      // highlight_color). Those propagate instantly via custom properties and
      // don't require a nuke+rescan. Frosted mode is the exception — its radius
      // lives in an SVG attribute and needs a full filter rebuild.
      const isActive = !!settings.blur_all_active;
      const reconcileKey = isActive
        ? `${settings.blur_mode}|${JSON.stringify(settings.blur_categories)}|${settings.thorough_blur}|${settings.blur_mode === blsi.blur_modes.frosted ? settings.blur_radius : ''}`
        : 'inactive';
      const pageWideChanged = reconcileKey !== _lastReconcileKey;
      _lastReconcileKey = reconcileKey;

      if (pageWideChanged) {
        const shadowRoots = await handleMainDocument(settings);
        if (shadowRoots.length) {
          await Promise.all(shadowRoots.map(sr => handleShadowRoot(settings, sr)));
        }
      }
      _isPageBlurred = isActive;

      // ── Item reconcile ──────────────────────────────────────────────────────
      // Runs in both active and inactive paths: picker blurs + sticky zones
      // persist when blur-all is off.
      const { added, removed } = _reconcileItems(settings.blur_items || []);

      // idempotent: re-inject on every call so mode/color changes take effect without a DOM pass
      if (settings.pick_blur_enabled && (settings.blur_items || []).length > 0) {
        injectPickBlurRules(document, settings.pick_blur_type, settings.pick_blur_color);
      } else {
        removePickBlurRules(document);
      }

      if (blsi.Logger && blsi.Logger.enabled) {
        blsi.Logger.scope('engine').flow('handleSite', {
          active: isActive,
          pageWideChanged,
          added,
          removed,
          totalActive: _activeItems.size,
        });
      }
    } finally {
      _handling = false;
    }
  }

  function _setPickerActiveForObserver(v) {
    _pickerActive = !!v;
  }


  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // Semi-private: exposed for unit tests only.
    // Do NOT call from content_script, popup, picker, or reveal — use handleSite().
    injectRules,
    removeRules,
    injectPickBlurRules,
    removePickBlurRules,
    isBlurAllActive,
    stampElements,
    tryBlurTextCheck,

    // Individual element (picker / context menu)
    applyBlur,
    removeBlur,
    toggleBlur,
    unblurAll,   // alias for teardown(document) + removeAllZoneOverlays
    teardown,

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

    // PII mode CSS injection
    injectPiiRules,
    removePiiRules,

    // Utilities
    ensureSvgFilter,
    CATEGORY_SELECTORS,

    // Counter allocation for picker callbacks
    resetCounters,
    allocateDynamicName,
    allocateStickyName,

    // Single orchestration entry point.
    // Caller must fold BLUR_ALL_ACTIVE and BLUR_ITEMS into settings before calling.
    handleSite,

    // Per-root dispatch. Public for unit tests; all production callers go through handleSite.
    handleDocument,       // thin router — backward compat / tests
    handleMainDocument,   // main document only, returns ShadowRoot[]
    handleShadowRoot,     // one shadow root, recurses into nested
    handleIframe,         // cross-origin iframes only
    observeRoot,
    disconnectObserver,
    get isPageBlurred() {
      return _isPageBlurred;
    },
    _setPickerActiveForObserver,
  };
})();

blsi.BlurEngine = BlurEngine;
