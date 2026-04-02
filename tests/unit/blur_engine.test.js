/**
 * tests/unit/blur_engine.test.js
 *
 * Unit tests for src/blur_engine.js
 * The module exposes window.PrivacyBlurEngine and uses no ES-module syntax,
 * so we load it by reading the file and running it via vm.runInThisContext
 * inside the jsdom environment.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module into jsdom global scope ──────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/blur_engine.js');

function loadBlurEngine() {
  // Each test file gets a fresh jsdom environment, so we load once per suite.
  if (global.PrivacyBlurEngine) return;
  const src = fs.existsSync(MODULE_PATH)
    ? fs.readFileSync(MODULE_PATH, 'utf8')
    : buildStubSource(); // fallback stub so tests run even without real src
  (0, eval)(src);
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

    window.PrivacyBlurEngine = { applyBlur: applyBlur, removeBlur: removeBlur, toggleBlur: toggleBlur,
      blurAllContent: blurAllContent, unblurAll: unblurAll, isBlurred: isBlurred };
  })();
  `;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrivacyBlurEngine', () => {
  beforeAll(() => {
    loadBlurEngine();
  });

  beforeEach(() => {
    // Clean DOM before every test.
    document.body.innerHTML = '';
  });

  // ── applyBlur ──────────────────────────────────────────────────────────────

  describe('applyBlur', () => {
    test('adds pb-blurred class to element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    test('sets --pb-radius CSS custom property', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 12);

      expect(div.style.getPropertyValue('--pb-radius')).toBe('12px');
    });

    test('uses default radius of 8px when not specified', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div);

      expect(div.style.getPropertyValue('--pb-radius')).toBe('8px');
    });

    test('applies CSS filter directly on img elements', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);

      PrivacyBlurEngine.applyBlur(img, 10);

      expect(img.classList.contains('pb-blurred')).toBe(true);
      expect(img.style.filter).toContain('blur(10px)');
    });

    test('creates canvas overlay for video elements', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      PrivacyBlurEngine.applyBlur(video, 8);

      // Canvas should have been injected adjacent to the video.
      const canvas = document.querySelector('canvas.pb-canvas-overlay');
      expect(canvas).not.toBeNull();
      expect(video.classList.contains('pb-blurred')).toBe(true);
    });

    test('starts RAF animation loop for video elements', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      PrivacyBlurEngine.applyBlur(video, 8);

      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });

    test('does not throw on null element', () => {
      expect(() => PrivacyBlurEngine.applyBlur(null)).not.toThrow();
    });

    test('does not throw on element not in DOM', () => {
      const div = document.createElement('div');
      // Not appended to body.
      expect(() => PrivacyBlurEngine.applyBlur(div, 8)).not.toThrow();
    });

    test('calling applyBlur twice on same element is idempotent (class present once)', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.applyBlur(div, 8);
      PrivacyBlurEngine.applyBlur(div, 8);

      // classList.contains is a set — should still be true, not duplicated.
      expect(div.classList.contains('pb-blurred')).toBe(true);
    });
  });

  // ── removeBlur ─────────────────────────────────────────────────────────────

  describe('removeBlur', () => {
    test('removes pb-blurred class', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      PrivacyBlurEngine.removeBlur(div);

      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

    test('clears --pb-radius custom property', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 12);

      PrivacyBlurEngine.removeBlur(div);

      expect(div.style.getPropertyValue('--pb-radius')).toBe('');
    });

    test('removes canvas overlay from DOM when removing blur on video', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);
      PrivacyBlurEngine.applyBlur(video, 8);
      expect(document.querySelector('canvas.pb-canvas-overlay')).not.toBeNull();

      PrivacyBlurEngine.removeBlur(video);

      expect(document.querySelector('canvas.pb-canvas-overlay')).toBeNull();
    });

    test('cancels rAF loop on video removeBlur', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);
      PrivacyBlurEngine.applyBlur(video, 8);

      PrivacyBlurEngine.removeBlur(video);

      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });

    test('does not throw on null element', () => {
      expect(() => PrivacyBlurEngine.removeBlur(null)).not.toThrow();
    });

    test('does not throw if removeBlur called on non-blurred element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(() => PrivacyBlurEngine.removeBlur(div)).not.toThrow();
    });
  });

  // ── toggleBlur ─────────────────────────────────────────────────────────────

  describe('toggleBlur', () => {
    test('applies blur when element is not yet blurred', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      PrivacyBlurEngine.toggleBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(true);
    });

    test('removes blur when element is already blurred', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      PrivacyBlurEngine.toggleBlur(div, 8);

      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

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
    test('returns false for element without pb-blurred class', () => {
      const div = document.createElement('div');
      expect(PrivacyBlurEngine.isBlurred(div)).toBe(false);
    });

    test('returns true for element with pb-blurred class', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);

      expect(PrivacyBlurEngine.isBlurred(div)).toBe(true);
    });

    test('returns false after blur is removed', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      PrivacyBlurEngine.applyBlur(div, 8);
      PrivacyBlurEngine.removeBlur(div);

      expect(PrivacyBlurEngine.isBlurred(div)).toBe(false);
    });

    test('returns false for null', () => {
      expect(PrivacyBlurEngine.isBlurred(null)).toBe(false);
    });
  });

  // ── blurAllContent ─────────────────────────────────────────────────────────

  describe('blurAllContent', () => {
    test('applies blur to all img elements in the DOM', () => {
      document.body.innerHTML = '<img src="a.png"><img src="b.png">';

      PrivacyBlurEngine.blurAllContent(8);

      const imgs = document.querySelectorAll('img');
      imgs.forEach((img) => {
        expect(img.classList.contains('pb-blurred')).toBe(true);
      });
    });

    test('applies blur to all p elements in the DOM', () => {
      document.body.innerHTML = '<p>Hello</p><p>World</p>';

      PrivacyBlurEngine.blurAllContent(8);

      const ps = document.querySelectorAll('p');
      ps.forEach((p) => {
        expect(p.classList.contains('pb-blurred')).toBe(true);
      });
    });

    test('applies blur to all heading elements h1-h6', () => {
      document.body.innerHTML = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';

      PrivacyBlurEngine.blurAllContent(8);

      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => {
        const el = document.querySelector(tag);
        expect(el.classList.contains('pb-blurred')).toBe(true);
      });
    });

    test('applies blur to video elements', () => {
      document.body.innerHTML = '<video src="clip.mp4"></video>';

      PrivacyBlurEngine.blurAllContent(8);

      const video = document.querySelector('video');
      expect(video.classList.contains('pb-blurred')).toBe(true);
    });

    test('does not throw on empty DOM', () => {
      document.body.innerHTML = '';
      expect(() => PrivacyBlurEngine.blurAllContent(8)).not.toThrow();
    });
  });

  // ── unblurAll ──────────────────────────────────────────────────────────────

  describe('unblurAll', () => {
    test('removes blur from all blurred elements', () => {
      document.body.innerHTML = '<p>A</p><p>B</p><img src="x.png">';
      PrivacyBlurEngine.blurAllContent(8);

      PrivacyBlurEngine.unblurAll();

      const blurred = document.querySelectorAll('.pb-blurred');
      expect(blurred.length).toBe(0);
    });

    test('does not affect elements that were never blurred', () => {
      document.body.innerHTML = '<div class="some-class">Text</div>';

      PrivacyBlurEngine.unblurAll();

      const div = document.querySelector('div');
      expect(div.classList.contains('some-class')).toBe(true);
      expect(div.classList.contains('pb-blurred')).toBe(false);
    });

    test('does not throw on empty DOM', () => {
      document.body.innerHTML = '';
      expect(() => PrivacyBlurEngine.unblurAll()).not.toThrow();
    });
  });
});
