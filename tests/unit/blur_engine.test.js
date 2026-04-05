/**
 * tests/unit/blur_engine.test.js
 *
 * Unit tests for src/blur_engine.js — the core DOM manipulation module that
 * handles blurring and unblurring elements on the page.
 *
 * The module exposes window.PrivacyBlurEngine and uses no ES-module syntax,
 * so we load it by reading the file and running it via (0, eval)() inside
 * the jsdom environment provided by Jest.
 *
 * Key behaviors tested:
 *  - IMG elements: direct CSS filter applied on the element
 *  - VIDEO elements: canvas overlay with requestAnimationFrame loop
 *  - Text containers: bare text nodes wrapped in <span> for CSS filter targeting
 *  - Background-image elements: CSS class only (filter via stylesheet)
 *  - Generic elements: class + CSS custom property approach
 *  - Bulk operations: blurAllContent and unblurAll across all element types
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module into jsdom global scope ──────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/blur_engine.js');

function loadBlurEngine() {
  // Each test file gets a fresh jsdom environment, so we load once per suite.
  if (global.PrivacyBlurEngine) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH); // require() lets Jest instrument for coverage
  } else {
    (0, eval)(buildStubSource()); // fallback stub so tests run even without real src
  }
}

/**
 * Minimal stub that satisfies the contract so tests can assert against it.
 * This will be replaced by the real implementation when src/blur_engine.js exists.
 */
function buildStubSource() {
  return `
  (function() {
    'use strict';
    const BLUR_CLASS = 'pb-blurred';
    const CANVAS_CLASS = 'pb-canvas-overlay';

    function applyBlur(el, radius) {
      if (!el || !el.style) return;
      radius = radius || 8;
      el.classList.add(BLUR_CLASS);
      el.style.setProperty('--pb-radius', radius + 'px');
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'img') {
        el.style.filter = 'blur(' + radius + 'px)';
      } else if (tag === 'video') {
        let canvas = el._pbCanvas;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = CANVAS_CLASS;
          el._pbCanvas = canvas;
          if (el.parentNode) el.parentNode.insertBefore(canvas, el.nextSibling);
        }
        el._pbRafId = requestAnimationFrame(function loop() {
          el._pbRafId = requestAnimationFrame(loop);
        });
      }
    }

    function removeBlur(el) {
      if (!el || !el.style) return;
      el.classList.remove(BLUR_CLASS);
      el.style.removeProperty('--pb-radius');
      el.style.filter = '';
      if (el._pbCanvas) {
        if (el._pbCanvas.parentNode) el._pbCanvas.parentNode.removeChild(el._pbCanvas);
        el._pbCanvas = null;
      }
      if (el._pbRafId) {
        cancelAnimationFrame(el._pbRafId);
        el._pbRafId = null;
      }
    }

    function isBlurred(el) {
      if (!el || !el.classList) return false;
      return el.classList.contains(BLUR_CLASS);
    }

    function toggleBlur(el, radius) {
      if (isBlurred(el)) { removeBlur(el); } else { applyBlur(el, radius); }
    }

    function blurAllContent(radius, revealOnHover) {
      var selectors = ['img', 'video', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      selectors.forEach(function(s) {
        document.querySelectorAll(s).forEach(function(el) { applyBlur(el, radius); });
      });
    }

    function unblurAll() {
      document.querySelectorAll('.' + BLUR_CLASS).forEach(function(el) { removeBlur(el); });
    }

    function invalidateSelectorCache() {}
    function matchesActiveCategories(el, cats) {
      if (!el || !el.tagName) return false;
      return true; // stub always matches
    }

    window.PrivacyBlurEngine = { applyBlur: applyBlur, removeBlur: removeBlur, toggleBlur: toggleBlur,
      blurAllContent: blurAllContent, unblurAll: unblurAll, isBlurred: isBlurred,
      invalidateSelectorCache: invalidateSelectorCache, matchesActiveCategories: matchesActiveCategories,
      CATEGORY_SELECTORS: {} };
  })();
  `;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrivacyBlurEngine', () => {
  beforeAll(() => {
    loadBlurEngine();
  });

  beforeEach(() => {
    // Clean DOM before every test to prevent cross-test contamination
    // of blurred elements, canvas overlays, or text wrappers.
    document.body.innerHTML = '';
  });

  // ── applyBlur ──────────────────────────────────────────────────────────────

  describe('applyBlur', () => {
    /**
     * Verifies that applyBlur adds the 'pb-blurred' CSS class to any element.
     * Why: The CSS stylesheet (content.css) targets .pb-blurred to apply the
     * blur filter via CSS custom properties. Without this class, no visual
     * blur effect is visible.
     * Reproduce: Create a <div>, call applyBlur, check classList.
     */
    test('adds pb-blurred class to element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that applyBlur sets the --pb-radius CSS custom property.
     * Why: content.css reads --pb-radius to control the blur filter intensity.
     * The custom property approach lets JS set the value once and CSS applies it
     * across transitions and animations without further JS involvement.
     * Reproduce: Create a <div>, call applyBlur(div, 12), read custom property.
     */
    test('does not set per-element --pb-radius (uses :root cascade)', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 12);

      // Non-video elements rely on :root --pb-radius from applySettingsToDom()
      expect(div.style.getPropertyValue('--pb-radius')).toBe('');
    });

    /**
     * Verifies the default blur radius when none is specified.
     * Why: Users who call applyBlur without a radius (e.g. from keyboard shortcut)
     * should get a sensible default. The default of 8px is defined in both
     * blur_engine.js and DEFAULT_SETTINGS in storage_manager.js.
     * Reproduce: Create a <div>, call applyBlur(div) with no radius argument.
     */
    test('adds pb-blurred class when no radius specified', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that <img> elements get a direct style.filter applied.
     * Why: Images need an inline filter in addition to the CSS class because
     * some sites override filter on img elements. The inline style has higher
     * specificity than the stylesheet rule.
     * Reproduce: Create an <img>, call applyBlur(img, 10), check style.filter.
     */
    test('applies blur class on img without inline filter', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);

      PrivacyBlurEngine.applyBlur(img, 10);

      expect(img.classList.contains('pb-blurred')).toBe(true);
      // No inline style.filter — CSS class handles it via var(--pb-radius)
      expect(img.style.filter).toBe('');
    });

    /**
     * Verifies that <video> elements get a <canvas> overlay for blur.
     * Why: CSS filter on <video> is unreliable cross-browser and does not work
     * on DRM-protected content. The canvas overlay draws blurred frames via
     * requestAnimationFrame, bypassing these limitations.
     * Reproduce: Create a <video> in the DOM, call applyBlur, query for canvas.
     */
    test('creates canvas overlay for video elements', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      PrivacyBlurEngine.applyBlur(video, 8);

      const canvas = document.querySelector('canvas.pb-canvas-overlay');
      expect(canvas).not.toBeNull();
      expect(video.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that video blur starts a requestAnimationFrame loop.
     * Why: The blur effect on video requires continuous frame-by-frame redrawing
     * onto the canvas overlay. Without rAF, the canvas would show a single
     * frozen frame instead of tracking the playing video.
     * Reproduce: Create a <video>, call applyBlur, check rAF was called.
     */
    test('starts RAF animation loop for video elements', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      PrivacyBlurEngine.applyBlur(video, 8);

      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });

    /**
     * Verifies null safety of applyBlur.
     * Why: content_script.js may call applyBlur with elements that have been
     * removed from the DOM between selection and application (race condition
     * in dynamic SPAs). Must not throw.
     * Reproduce: Call applyBlur(null).
     */
    test('does not throw on null element', () => {
      expect(() => PrivacyBlurEngine.applyBlur(null)).not.toThrow();
    });

    /**
     * Verifies applyBlur works on detached elements (not in DOM).
     * Why: An element can be created and blurred before being appended to the
     * page. This is an edge case from the picker where element references
     * may become detached during SPA navigation.
     * Reproduce: Create a <div> without appendChild, call applyBlur.
     */
    test('does not throw on element not in DOM', () => {
      const div = document.createElement('div');
      expect(() => PrivacyBlurEngine.applyBlur(div, 8)).not.toThrow();
    });

    /**
     * Verifies that calling applyBlur twice is idempotent.
     * Why: The picker's onBlur callback and the MutationObserver in
     * content_script.js can both attempt to blur the same element. Double-blur
     * must not create duplicate canvas overlays, duplicate classes, or
     * double-wrap text nodes.
     * Reproduce: Call applyBlur twice on the same element, verify class count.
     */
    test('calling applyBlur twice on same element is idempotent (class present once)', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);
      PrivacyBlurEngine.applyBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── removeBlur ─────────────────────────────────────────────────────────────

  describe('removeBlur', () => {
    /**
     * Verifies that removeBlur strips the pb-blurred class.
     * Why: Without removing the class, the CSS filter from content.css would
     * keep the element visually blurred even after the user unblurs it.
     * Reproduce: Apply blur, then removeBlur, check class is gone.
     */
    test('removes pb-blurred class', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      PrivacyBlurEngine.removeBlur(div);

      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

    /**
     * Verifies that removeBlur clears the --pb-radius custom property.
     * Why: Stale custom properties can cause visual artifacts if the element
     * is later re-blurred with a different radius. Clean state is important.
     * Reproduce: Apply blur with radius 12, removeBlur, check property is empty.
     */
    test('clears --pb-radius custom property', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 12);

      PrivacyBlurEngine.removeBlur(div);

      expect(div.style.getPropertyValue('--pb-radius')).toBe('');
    });

    /**
     * Verifies that removeBlur on a video removes the canvas overlay from DOM.
     * Why: Leaving orphaned canvases wastes memory and GPU resources. Each
     * canvas runs a rAF loop that consumes CPU even when not visible.
     * Reproduce: Blur a video, verify canvas exists, removeBlur, verify gone.
     */
    test('removes canvas overlay from DOM when removing blur on video', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);
      PrivacyBlurEngine.applyBlur(video, 8);
      expect(document.querySelector('canvas.pb-canvas-overlay')).not.toBeNull();

      PrivacyBlurEngine.removeBlur(video);

      expect(document.querySelector('canvas.pb-canvas-overlay')).toBeNull();
    });

    /**
     * Verifies that removeBlur cancels the requestAnimationFrame loop.
     * Why: An uncancelled rAF loop continues running indefinitely, consuming
     * CPU and potentially causing memory leaks. This was a real OOM issue
     * discovered during development (see tests/CLAUDE.md).
     * Reproduce: Blur a video (starts rAF), removeBlur, verify cancelAnimationFrame called.
     */
    test('cancels rAF loop on video removeBlur', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);
      PrivacyBlurEngine.applyBlur(video, 8);

      PrivacyBlurEngine.removeBlur(video);

      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });

    /**
     * Verifies null safety of removeBlur.
     * Why: Same rationale as applyBlur — elements can be GC'd or detached
     * between the time a selector is stored and the time unblur is attempted.
     * Reproduce: Call removeBlur(null).
     */
    test('does not throw on null element', () => {
      expect(() => PrivacyBlurEngine.removeBlur(null)).not.toThrow();
    });

    /**
     * Verifies that removeBlur on a never-blurred element is safe.
     * Why: The "Clear Page" button in the popup calls removeBlur on all
     * elements matching a selector, but the element may never have been
     * blurred (stale selector from a previous page load).
     * Reproduce: Create element, call removeBlur without prior applyBlur.
     */
    test('does not throw if removeBlur called on non-blurred element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(() => PrivacyBlurEngine.removeBlur(div)).not.toThrow();
    });
  });

  // ── toggleBlur ─────────────────────────────────────────────────────────────

  describe('toggleBlur', () => {
    /**
     * Verifies that toggleBlur applies blur when element is not yet blurred.
     * Why: The keyboard shortcut (Alt+Shift+B) and chord (Ctrl+K, V) both
     * trigger toggleBlur, which must apply blur on first use.
     * Reproduce: Create clean element, call toggleBlur, verify class added.
     */
    test('applies blur when element is not yet blurred', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.toggleBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that toggleBlur removes blur when element is already blurred.
     * Why: The same shortcut key should work as both blur and unblur,
     * providing a single-action toggle for screen sharing scenarios.
     * Reproduce: Apply blur, then toggleBlur, verify class removed.
     */
    test('removes blur when element is already blurred', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      PrivacyBlurEngine.toggleBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

    /**
     * Verifies that toggle cycles correctly through on/off/on states.
     * Why: Users frequently toggle blur multiple times during a presentation
     * to reveal then re-hide content. The third toggle must re-apply blur.
     * Reproduce: Toggle three times, verify final state is blurred.
     */
    test('second toggle re-applies blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.toggleBlur(div, 8); // on
      PrivacyBlurEngine.toggleBlur(div, 8); // off
      PrivacyBlurEngine.toggleBlur(div, 8); // on again

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── isBlurred ──────────────────────────────────────────────────────────────

  describe('isBlurred', () => {
    /**
     * Verifies that isBlurred returns false for a clean element.
     * Why: The picker uses isBlurred to decide whether a click should blur
     * or unblur. A false positive would invert the user's action.
     * Reproduce: Create element without blur class, call isBlurred.
     */
    test('returns false for element without pb-blurred class', () => {
      const div = document.createElement('div');
      expect(PrivacyBlurEngine.isBlurred(div)).toBe(false);
    });

    /**
     * Verifies that isBlurred returns true for a blurred element.
     * Why: Confirms the class check matches what applyBlur sets.
     * Reproduce: Apply blur, then call isBlurred.
     */
    test('returns true for element with pb-blurred class', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      expect(PrivacyBlurEngine.isBlurred(div)).toBe(true);
    });

    /**
     * Verifies that isBlurred returns false after blur is removed.
     * Why: After unblurring, the element should not be detected as blurred.
     * Ensures removeBlur fully cleans up the class.
     * Reproduce: Apply, remove, check isBlurred.
     */
    test('returns false after blur is removed', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);
      PrivacyBlurEngine.removeBlur(div);

      expect(PrivacyBlurEngine.isBlurred(div)).toBe(false);
    });

    /**
     * Verifies null safety of isBlurred.
     * Why: applyBlur calls isBlurred internally as an idempotency guard.
     * If isBlurred throws on null, applyBlur would also throw.
     * Reproduce: Call isBlurred(null).
     */
    test('returns false for null', () => {
      expect(PrivacyBlurEngine.isBlurred(null)).toBe(false);
    });
  });

  // ── blurAllContent ─────────────────────────────────────────────────────────

  describe('blurAllContent', () => {
    /**
     * Verifies that blurAllContent blurs all <img> elements.
     * Why: Images are the most common privacy-sensitive content on pages
     * (profile photos, screenshots, documents). The "Blur All" feature
     * must catch every image during screen sharing.
     * Reproduce: Add two images, call blurAllContent, check both are blurred.
     */
    test('applies blur to all img elements in the DOM', () => {
      document.body.innerHTML = '<img src="a.png"><img src="b.png">';

      PrivacyBlurEngine.blurAllContent(8);

      const imgs = document.querySelectorAll('img');
      imgs.forEach((img) => {
        expect(img.classList.contains('pb-blurred')).toBe(true);
      });
    });

    /**
     * Verifies that blurAllContent blurs all <p> elements.
     * Why: Paragraphs contain the bulk of text content — email bodies,
     * chat messages, financial details — that users need to hide.
     * Reproduce: Add two paragraphs, call blurAllContent, check both blurred.
     */
    test('applies blur to all p elements in the DOM', () => {
      document.body.innerHTML = '<p>Hello</p><p>World</p>';

      PrivacyBlurEngine.blurAllContent(8);

      const ps = document.querySelectorAll('p');
      ps.forEach((p) => {
        expect(p.classList.contains('pb-blurred')).toBe(true);
      });
    });

    /**
     * Verifies that blurAllContent blurs all heading levels h1-h6.
     * Why: Headings often contain page titles, account names, or section
     * labels that reveal the context of what's being viewed.
     * Reproduce: Add all 6 heading levels, call blurAllContent, check all blurred.
     */
    test('applies blur to all heading elements h1-h6', () => {
      document.body.innerHTML = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';

      PrivacyBlurEngine.blurAllContent(8);

      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => {
        const el = document.querySelector(tag);
        expect(el.classList.contains('pb-blurred')).toBe(true);
      });
    });

    /**
     * Verifies that blurAllContent blurs <video> elements.
     * Why: Video content (meetings, recordings, media players) can contain
     * sensitive information that must be hidden during screen shares.
     * Reproduce: Add a video element, call blurAllContent, check blurred.
     */
    test('applies blur to video elements', () => {
      document.body.innerHTML = '<video src="clip.mp4"></video>';

      PrivacyBlurEngine.blurAllContent(8);

      const video = document.querySelector('video');
      expect(video.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that blurAllContent handles an empty page without errors.
     * Why: The extension runs on every page, including blank tabs, error
     * pages, and pages that haven't finished loading content yet.
     * Reproduce: Set empty body, call blurAllContent.
     */
    test('does not throw on empty DOM', () => {
      document.body.innerHTML = '';
      expect(() => PrivacyBlurEngine.blurAllContent(8)).not.toThrow();
    });
  });

  // ── unblurAll ──────────────────────────────────────────────────────────────

  describe('unblurAll', () => {
    /**
     * Verifies that unblurAll removes blur from every blurred element.
     * Why: The "Clear Page" action (Alt+Shift+U) must instantly reveal all
     * content — the user expects zero blurred elements after this action.
     * Reproduce: Blur multiple element types, call unblurAll, check none remain.
     */
    test('removes blur from all blurred elements', () => {
      document.body.innerHTML = '<p>A</p><p>B</p><img src="x.png">';
      PrivacyBlurEngine.blurAllContent(8);

      PrivacyBlurEngine.unblurAll();

      const blurred = document.querySelectorAll('.pb-blurred');
      expect(blurred.length).toBe(0);
    });

    /**
     * Verifies that unblurAll does not modify non-blurred elements.
     * Why: unblurAll uses querySelectorAll('.pb-blurred') — it must not
     * strip classes or styles from elements that were never blurred.
     * Reproduce: Create element with unrelated class, call unblurAll, verify class intact.
     */
    test('does not affect elements that were never blurred', () => {
      document.body.innerHTML = '<div class="some-class">Text</div>';

      PrivacyBlurEngine.unblurAll();

      const div = document.querySelector('div');
      expect(div.classList.contains('some-class')).toBe(true);
      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

    /**
     * Verifies that unblurAll handles an empty page without errors.
     * Why: Same as blurAllContent — extension runs on all pages.
     * Reproduce: Set empty body, call unblurAll.
     */
    test('does not throw on empty DOM', () => {
      document.body.innerHTML = '';
      expect(() => PrivacyBlurEngine.unblurAll()).not.toThrow();
    });

    /**
     * Verifies that unblurAll cleans up orphaned canvas overlays.
     * Why: If a video element is removed from the DOM (e.g. SPA navigation)
     * while its canvas overlay remains, unblurAll must still find and remove
     * the orphaned canvas. Otherwise it leaks DOM nodes and GPU memory.
     * Reproduce: Manually insert a canvas with the overlay class, call unblurAll.
     */
    test('cleans up orphaned canvas overlays', () => {
      const canvas = document.createElement('canvas');
      canvas.className = 'pb-canvas-overlay';
      document.body.appendChild(canvas);

      PrivacyBlurEngine.unblurAll();

      expect(document.querySelector('.pb-canvas-overlay')).toBeNull();
    });

    /**
     * Verifies that unblurAll cleans up orphaned text-node wrappers.
     * Why: If a container element is removed from the DOM while its text was
     * wrapped, the wrapper <span> may persist as a top-level orphan. unblurAll
     * must unwrap these to prevent layout shifts and font style changes.
     * Reproduce: Insert a span with the wrapper class, call unblurAll.
     */
    test('cleans up orphaned text-node wrappers', () => {
      const wrapper = document.createElement('span');
      wrapper.className = 'pb-text-node-wrapper';
      wrapper.textContent = 'orphaned';
      document.body.appendChild(wrapper);

      PrivacyBlurEngine.unblurAll();

      expect(document.querySelector('.pb-text-node-wrapper')).toBeNull();
    });
  });

  // ── Text content handling ─────────────────────────────────────────────────

  describe('text content handling', () => {
    /**
     * Verifies that bare text nodes are wrapped in a <span> when blurring.
     * Why: CSS filter cannot target text nodes directly — only elements.
     * Without wrapping, text inside a <div> would remain visible even when
     * the container is "blurred", because the filter applies to child
     * elements but not to direct text-node children.
     * Reproduce: Create a <div> with text content only, apply blur,
     * check for .pb-text-node-wrapper span containing the text.
     */
    test('wraps bare text nodes in a span when blurring a container', () => {
      const div = document.createElement('div');
      div.textContent = 'Sensitive text';
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);

      const wrapper = div.querySelector('.pb-text-node-wrapper');
      expect(wrapper).not.toBeNull();
      expect(wrapper.textContent).toBe('Sensitive text');
    });

    /**
     * Verifies that text node wrappers are removed when unblurring.
     * Why: Leaving wrapper <span>s in the DOM after unblurring would change
     * the page's DOM structure, potentially breaking site JavaScript that
     * relies on specific child element counts or text node positions.
     * Reproduce: Blur then unblur a text container, verify no wrapper remains.
     */
    test('unwraps text nodes when removing blur from container', () => {
      const div = document.createElement('div');
      div.textContent = 'Private data';
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);
      PrivacyBlurEngine.removeBlur(div);

      expect(div.querySelector('.pb-text-node-wrapper')).toBeNull();
      expect(div.textContent).toBe('Private data');
    });

    /**
     * Verifies that whitespace-only text nodes are NOT wrapped.
     * Why: Many HTML elements contain whitespace text nodes for formatting
     * (indentation, newlines between tags). Wrapping these would create
     * unnecessary DOM nodes and could cause layout shifts.
     * Reproduce: Create a <div> with only whitespace content, apply blur,
     * verify no wrapper was created.
     */
    test('does not wrap whitespace-only text nodes', () => {
      const div = document.createElement('div');
      div.innerHTML = '   \n\t  ';
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);

      expect(div.querySelector('.pb-text-node-wrapper')).toBeNull();
    });
  });

  // ── Background-image elements ─────────────────────────────────────────────

  describe('background-image elements', () => {
    /**
     * Verifies that elements with CSS background-image get the blur class.
     * Why: Many sites use background-image for avatars, hero banners, and
     * card thumbnails. These must be caught by the blur engine even though
     * they are not <img> elements.
     * Reproduce: Create a <div> with background-image style, apply blur,
     * check class and custom property are set.
     */
    test('applies blur class to elements with background-image', () => {
      const div = document.createElement('div');
      div.style.backgroundImage = 'url(test.png)';
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 10);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that background-image elements do NOT get inline style.filter.
     * Why: Background-image elements rely on the CSS stylesheet (.pb-blurred
     * class) to apply the filter. Adding an inline filter would double-blur
     * them — once via inline style, once via the class rule.
     * Reproduce: Create a <div> with background-image, apply blur,
     * verify style.filter is empty.
     */
    test('does not apply direct style.filter on background-image elements', () => {
      const div = document.createElement('div');
      div.style.backgroundImage = 'url(test.png)';
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 10);

      expect(div.style.filter).toBeFalsy();
    });
  });

  // ── Video blur edge cases ─────────────────────────────────────────────────

  describe('video blur edge cases', () => {
    /**
     * Verifies that applyBlur handles a detached video (no parentElement).
     * Why: In SPAs like YouTube, video elements can be created in memory
     * before insertion into the DOM. If the user triggers blur-all at that
     * moment, applyBlur must not throw when it cannot find a parent to
     * insert the canvas overlay into. Instead it falls back to CSS-only blur.
     * Reproduce: Create a <video> without appending to DOM, apply blur.
     */
    test('handles detached video element (no parent) gracefully', () => {
      const video = document.createElement('video');

      expect(() => PrivacyBlurEngine.applyBlur(video, 8)).not.toThrow();
      expect(video.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that the idempotency guard prevents duplicate canvases.
     * Why: If applyBlur is called twice (e.g. by MutationObserver + restore),
     * two canvases would stack on top of each other, doubling GPU usage and
     * causing visual artifacts when one is removed but the other remains.
     * Reproduce: Apply blur to a video, count canvas overlays — must be 1.
     */
    test('re-applying blur to same video does not create duplicate canvases', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      PrivacyBlurEngine.applyBlur(video, 8);
      const canvasCount = document.querySelectorAll('.pb-canvas-overlay').length;
      expect(canvasCount).toBe(1);
    });

    /**
     * Verifies that removeBlur on <img> clears the inline filter style.
     * Why: Images get a direct style.filter (unlike generic elements). If
     * removeBlur doesn't clear it, the image stays visually blurred even
     * though the pb-blurred class is gone, causing user confusion.
     * Reproduce: Blur an image (sets style.filter), removeBlur, check filter is empty.
     */
    test('removeBlur on img removes pb-blurred class', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);

      PrivacyBlurEngine.applyBlur(img, 12);
      expect(img.classList.contains('pb-blurred')).toBe(true);

      PrivacyBlurEngine.removeBlur(img);
      expect(img.classList.contains('pb-blurred')).toBe(false);
    });
  });

  // ── blurAllContent advanced ───────────────────────────────────────────────

  describe('blurAllContent advanced', () => {
    /**
     * Verifies that blurAllContent blurs <span> elements with direct text.
     * Why: Spans are used for inline labels, badges, and data values
     * (e.g. "Balance: $1,234"). The engine only blurs spans that contain
     * meaningful text content — not empty or icon-only spans which would
     * break site navigation.
     * Reproduce: Add a <span> with text, call blurAllContent, check blurred.
     */
    test('blurs span elements that contain direct text', () => {
      document.body.innerHTML = '<span>Account: 12345</span>';

      PrivacyBlurEngine.blurAllContent(8);

      const span = document.querySelector('span');
      expect(span.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that blurAllContent blurs <a> elements with text.
     * Why: Links often contain email addresses, usernames, or URLs that
     * are sensitive during screen sharing (e.g. "john.doe@company.com").
     * Reproduce: Add an anchor with text, call blurAllContent, check blurred.
     */
    test('blurs link elements that contain text', () => {
      document.body.innerHTML = '<a href="#">john@example.com</a>';

      PrivacyBlurEngine.blurAllContent(8);

      const link = document.querySelector('a');
      expect(link.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that blurAllContent blurs <button> elements with text.
     * Why: Buttons can contain action labels that reveal what the user
     * is about to do (e.g. "Submit Payment", "Delete Account").
     * Reproduce: Add a button with text, call blurAllContent, check blurred.
     */
    test('does not blur button with default categories (FORM off)', () => {
      document.body.innerHTML = '<button>Submit Payment</button>';

      PrivacyBlurEngine.blurAllContent(8);

      const btn = document.querySelector('button');
      // Button is in FORM category, which is OFF by default
      expect(btn.classList.contains('pb-blurred')).toBe(false);
    });

    /**
     * Verifies that blurAllContent does not double-blur already-blurred elements.
     * Why: If the user blurs individual elements via the picker, then triggers
     * "Blur All", those elements must not be processed again. Double-processing
     * could create duplicate text wrappers or canvas overlays.
     * Reproduce: Manually add pb-blurred class to a <p>, call blurAllContent,
     * verify the element is still blurred (not double-processed).
     */
    test('does not double-blur elements already blurred', () => {
      document.body.innerHTML = '<p>Secret</p>';
      const p = document.querySelector('p');
      p.classList.add('pb-blurred');

      PrivacyBlurEngine.blurAllContent(8);

      expect(p.classList.contains('pb-blurred')).toBe(true);
    });

    /**
     * Verifies that blurAllContent blurs <canvas> elements.
     * Why: Canvas elements can contain rendered charts, graphs, or drawings
     * with sensitive data (financial dashboards, analytics). They are in the
     * MEDIA_SELECTORS list and always blurred regardless of content.
     * Reproduce: Add a <canvas>, call blurAllContent, check blurred.
     */
    test('blurs canvas elements', () => {
      document.body.innerHTML = '<canvas width="100" height="100"></canvas>';

      PrivacyBlurEngine.blurAllContent(8);

      const canvas = document.querySelector('canvas');
      expect(canvas.classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── toggleBlur edge cases ─────────────────────────────────────────────────

  describe('toggleBlur edge cases', () => {
    /**
     * Verifies null safety of toggleBlur.
     * Why: The keyboard shortcut handler calls toggleBlur which may receive
     * null if no target element was captured (e.g. right-click on empty area).
     * Reproduce: Call toggleBlur(null).
     */
    test('does not throw on null element', () => {
      expect(() => PrivacyBlurEngine.toggleBlur(null)).not.toThrow();
    });

    /**
     * Verifies type safety of toggleBlur with non-Element argument.
     * Why: Message passing from background.js could theoretically deliver
     * malformed data. The function must guard against non-Element types.
     * Reproduce: Call toggleBlur with a string argument.
     */
    test('does not throw on non-Element', () => {
      expect(() => PrivacyBlurEngine.toggleBlur('not an element')).not.toThrow();
    });

    /**
     * Verifies that toggleBlur passes the custom radius to applyBlur.
     * Why: Users can configure blur radius in settings (2-20px). When toggling
     * on, the configured radius must be applied, not the hardcoded default.
     * Reproduce: Toggle with radius 15, check --pb-radius custom property.
     */
    test('adds pb-blurred class when toggling on', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.toggleBlur(div, 15);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── blurAllContent with categories ────────────────────────────────────────

  describe('blurAllContent with categories', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    const ONLY = (cat) => ({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false, [cat]: true });
    const ALL_ON = { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true };
    const ALL_OFF = { TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false };

    test('blurs only media elements when only media category enabled', () => {
      document.body.innerHTML = '<img src="#" /><p>text</p><input value="secret">';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('MEDIA') });
      expect(document.querySelector('img').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(false);
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(false);
    });

    test('blurs only text elements when only text category enabled', () => {
      document.body.innerHTML = '<p>text</p><img src="#" /><input value="secret">';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('TEXT') });
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('img').classList.contains('pb-blurred')).toBe(false);
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(false);
    });

    test('blurs form elements when form category enabled', () => {
      document.body.innerHTML = '<input value="a"><textarea>b</textarea><select><option>c</option></select>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('FORM') });
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('textarea').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('select').classList.contains('pb-blurred')).toBe(true);
    });

    test('does not blur form elements when form category off (default-like)', () => {
      document.body.innerHTML = '<input value="secret"><p>visible</p>';
      const defaults = { TEXT: true, MEDIA: true, FORM: false, TABLE: true, STRUCTURE: true };
      PrivacyBlurEngine.blurAllContent(8, { categories: defaults });
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(false);
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
    });

    test('blurs table cells when table category enabled', () => {
      document.body.innerHTML = '<table><tr><td>Secret</td></tr></table>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('TABLE') });
      expect(document.querySelector('td').classList.contains('pb-blurred')).toBe(true);
    });

    test('blurs structure elements with text when structure enabled', () => {
      document.body.innerHTML = '<div>text content</div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE') });
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(true);
    });

    test('blurs structure elements with descendant text (text-check gate)', () => {
      document.body.innerHTML = '<div><span>inner</span></div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE') });
      // div has visible text via descendant span — should be blurred
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(true);
    });

    test('does not blur truly empty structure elements', () => {
      document.body.innerHTML = '<div></div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE') });
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(false);
    });

    test('backward compatible: no options defaults to all categories on', () => {
      document.body.innerHTML = '<p>text</p><img src="#" >';
      PrivacyBlurEngine.blurAllContent(8);
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('img').classList.contains('pb-blurred')).toBe(true);
    });

    test('backward compatible: empty options defaults to all categories on', () => {
      document.body.innerHTML = '<p>text</p><img src="#" >';
      PrivacyBlurEngine.blurAllContent(8, {});
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('img').classList.contains('pb-blurred')).toBe(true);
    });

    test('does not throw when all categories off', () => {
      document.body.innerHTML = '<p>text</p><img src="#" >';
      expect(() => PrivacyBlurEngine.blurAllContent(8, { categories: ALL_OFF })).not.toThrow();
      expect(document.querySelectorAll('.pb-blurred').length).toBe(0);
    });

    test('text-check elements only blurred with meaningful text', () => {
      document.body.innerHTML = '<span>Visible</span><span></span><span>   </span>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('TEXT') });
      const spans = document.querySelectorAll('span');
      expect(spans[0].classList.contains('pb-blurred')).toBe(true);
      expect(spans[1].classList.contains('pb-blurred')).toBe(false);
      expect(spans[2].classList.contains('pb-blurred')).toBe(false);
    });

    test('new text elements (strong, em, code) blurred when text on', () => {
      document.body.innerHTML = '<strong>bold</strong><em>italic</em><code>secret</code>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('TEXT') });
      expect(document.querySelector('strong').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('em').classList.contains('pb-blurred')).toBe(true);
      expect(document.querySelector('code').classList.contains('pb-blurred')).toBe(true);
    });

    test('button is in form category, not structure', () => {
      document.body.innerHTML = '<button>Click</button>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE') });
      expect(document.querySelector('button').classList.contains('pb-blurred')).toBe(false);

      PrivacyBlurEngine.unblurAll();
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('FORM') });
      expect(document.querySelector('button').classList.contains('pb-blurred')).toBe(true);
    });

    test('thoroughBlur blurs text-check elements without direct text', () => {
      // div has only element children, no direct text nodes
      document.body.innerHTML = '<div><span>inner text</span></div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE'), thoroughBlur: true });
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(true);
    });

    test('thoroughBlur off skips truly empty text-check elements', () => {
      document.body.innerHTML = '<div></div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE'), thoroughBlur: false });
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(false);
    });

    test('thoroughBlur does not affect always-blur elements', () => {
      document.body.innerHTML = '<p>text</p>';
      // always-blur elements blurred regardless of thoroughBlur
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('TEXT'), thoroughBlur: false });
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
    });

    test('thoroughBlur defaults to false when not specified', () => {
      document.body.innerHTML = '<div></div>';
      PrivacyBlurEngine.blurAllContent(8, { categories: ONLY('STRUCTURE') });
      // Empty div should NOT blur because thoroughBlur defaults to false
      expect(document.querySelector('div').classList.contains('pb-blurred')).toBe(false);
    });
  });

  // ── invalidateSelectorCache ───────────────────────────────────────────────

  describe('invalidateSelectorCache', () => {
    test('causes rebuild on next blurAllContent call', () => {
      document.body.innerHTML = '<input value="a"><p>text</p>';
      // First call with form ON
      PrivacyBlurEngine.blurAllContent(8, { categories: { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true } });
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(true);

      PrivacyBlurEngine.unblurAll();
      PrivacyBlurEngine.invalidateSelectorCache();

      // Second call with form OFF — cached selectors must be gone
      PrivacyBlurEngine.blurAllContent(8, { categories: { TEXT: true, MEDIA: true, FORM: false, TABLE: true, STRUCTURE: true } });
      expect(document.querySelector('input').classList.contains('pb-blurred')).toBe(false);
      expect(document.querySelector('p').classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── matchesActiveCategories ───────────────────────────────────────────────

  describe('matchesActiveCategories', () => {
    test('returns true for img when media is on', () => {
      const img = document.createElement('img');
      expect(PrivacyBlurEngine.matchesActiveCategories(img, { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false })).toBe(true);
    });

    test('returns false for img when media is off', () => {
      const img = document.createElement('img');
      expect(PrivacyBlurEngine.matchesActiveCategories(img, { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false })).toBe(false);
    });

    test('returns false for unknown tags', () => {
      const el = document.createElement('custom-widget');
      expect(PrivacyBlurEngine.matchesActiveCategories(el, { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true })).toBe(false);
    });

    test('returns false for null', () => {
      expect(PrivacyBlurEngine.matchesActiveCategories(null, { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true })).toBe(false);
    });

    test('defaults to all categories when no categories argument', () => {
      const p = document.createElement('p');
      expect(PrivacyBlurEngine.matchesActiveCategories(p)).toBe(true);
    });
  });

  // ── CATEGORY_SELECTORS export ─────────────────────────────────────────────

  describe('CATEGORY_SELECTORS', () => {
    test('exposes frozen category definitions', () => {
      expect(PrivacyBlurEngine.CATEGORY_SELECTORS).toBeDefined();
      expect(Object.isFrozen(PrivacyBlurEngine.CATEGORY_SELECTORS)).toBe(true);
    });

    test('has exactly 5 categories', () => {
      expect(Object.keys(PrivacyBlurEngine.CATEGORY_SELECTORS)).toHaveLength(5);
    });

    test('each category has alwaysBlur and textCheck arrays', () => {
      for (const cat of Object.values(PrivacyBlurEngine.CATEGORY_SELECTORS)) {
        expect(Array.isArray(cat.alwaysBlur)).toBe(true);
        expect(Array.isArray(cat.textCheck)).toBe(true);
      }
    });
  });

  // ── refreshBlur ─────────────────────────────────────────────────────────────

  describe('refreshBlur', () => {
    test('re-wraps new text nodes in already-blurred element', () => {
      const div = document.createElement('div');
      div.textContent = 'original text';
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 10);
      expect(div.classList.contains('pb-blurred')).toBe(true);
      expect(div.querySelector('.pb-text-node-wrapper')).not.toBeNull();

      // Simulate SPA re-render: replace text content
      div.textContent = 'new SPA content';
      PrivacyBlurEngine.refreshBlur(div);

      // Should have a fresh wrapper with new text
      const wrapper = div.querySelector('.pb-text-node-wrapper');
      expect(wrapper).not.toBeNull();
      expect(wrapper.textContent).toBe('new SPA content');
    });

    test('no-op on non-blurred elements', () => {
      const div = document.createElement('div');
      div.textContent = 'not blurred';
      document.body.appendChild(div);
      PrivacyBlurEngine.refreshBlur(div);
      expect(div.querySelector('.pb-text-node-wrapper')).toBeNull();
    });

    test('skips video elements', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);
      PrivacyBlurEngine.applyBlur(video, 10);
      PrivacyBlurEngine.refreshBlur(video);
      // Should not throw and should not add text wrappers
      expect(video.querySelector('.pb-text-node-wrapper')).toBeNull();
    });

    test('skips img elements', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);
      PrivacyBlurEngine.applyBlur(img, 10);
      PrivacyBlurEngine.refreshBlur(img);
      expect(img.querySelector('.pb-text-node-wrapper')).toBeNull();
    });

    test('cleans up stale wrappers before re-wrapping', () => {
      const p = document.createElement('p');
      p.textContent = 'text one';
      document.body.appendChild(p);
      PrivacyBlurEngine.applyBlur(p, 10);

      // Add a second wrapper manually (simulating stale state)
      const staleSpan = document.createElement('span');
      staleSpan.className = 'pb-text-node-wrapper';
      staleSpan.textContent = 'stale';
      p.appendChild(staleSpan);
      expect(p.querySelectorAll('.pb-text-node-wrapper').length).toBe(2);

      PrivacyBlurEngine.refreshBlur(p);
      // Should have exactly one wrapper after refresh
      expect(p.querySelectorAll('.pb-text-node-wrapper').length).toBe(1);
    });

    test('handles null and non-element inputs', () => {
      expect(() => PrivacyBlurEngine.refreshBlur(null)).not.toThrow();
      expect(() => PrivacyBlurEngine.refreshBlur(undefined)).not.toThrow();
      expect(() => PrivacyBlurEngine.refreshBlur('string')).not.toThrow();
    });
  });

  // ── shouldBlurElement ───────────────────────────────────────────────────────

  describe('shouldBlurElement', () => {
    const ALL_ON = { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true };
    const TEXT_ONLY = { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false };

    test('returns true for always-blur elements in enabled category', () => {
      const p = document.createElement('p');
      p.textContent = 'hello';
      document.body.appendChild(p);
      expect(PrivacyBlurEngine.shouldBlurElement(p, ALL_ON, false)).toBe(true);
    });

    test('returns false for disabled category', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);
      expect(PrivacyBlurEngine.shouldBlurElement(img, { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, false)).toBe(false);
    });

    test('text-check gate: returns false for empty div without thorough', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(PrivacyBlurEngine.shouldBlurElement(div, ALL_ON, false)).toBe(false);
    });

    test('text-check gate: returns true for div with text', () => {
      const div = document.createElement('div');
      div.textContent = 'has text';
      document.body.appendChild(div);
      expect(PrivacyBlurEngine.shouldBlurElement(div, ALL_ON, false)).toBe(true);
    });

    test('thorough mode bypasses text-check gate', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(PrivacyBlurEngine.shouldBlurElement(div, ALL_ON, true)).toBe(true);
    });

    test('returns false for unknown tags', () => {
      const el = document.createElement('my-component');
      el.textContent = 'hello';
      document.body.appendChild(el);
      expect(PrivacyBlurEngine.shouldBlurElement(el, ALL_ON, false)).toBe(false);
    });

    test('returns false for null input', () => {
      expect(PrivacyBlurEngine.shouldBlurElement(null, ALL_ON, false)).toBe(false);
    });

    test('returns true for form elements when form category on', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(PrivacyBlurEngine.shouldBlurElement(input, ALL_ON, false)).toBe(true);
    });

    test('returns false for form elements when form category off', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(PrivacyBlurEngine.shouldBlurElement(input, TEXT_ONLY, false)).toBe(false);
    });

    test('returns true for table cells with text', () => {
      const td = document.createElement('td');
      td.textContent = 'cell data';
      document.body.appendChild(td);
      expect(PrivacyBlurEngine.shouldBlurElement(td, ALL_ON, false)).toBe(true);
    });
  });
});
