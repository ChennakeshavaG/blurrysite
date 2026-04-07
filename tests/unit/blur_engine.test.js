/**
 * tests/unit/blur_engine.test.js
 *
 * Unit tests for src/blur_engine.js — hybrid CSS + data-attribute blur engine.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/blur_engine.js');

function loadBlurEngine() {
  if (pb.BlurEngine) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    throw new Error('blur_engine.js not found');
  }
}

beforeAll(() => { loadBlurEngine(); });

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('#pb-blur-styles').forEach(el => el.remove());
  document.querySelectorAll('[data-pb-blur]').forEach(el => delete el.dataset.pbBlur);
  jest.clearAllMocks();
});

afterEach(() => { pb.BlurEngine.unblurAll(); });

describe('pb.BlurEngine', () => {

  describe('injectBlurRules', () => {
    test('creates style element in head', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.getElementById('pb-blur-styles')).not.toBeNull();
    });

    test('style contains always-blur tag selectors', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false });
      const css = document.getElementById('pb-blur-styles').textContent;
      expect(css).toContain('h1');
      expect(css).toContain('img');
      expect(css).not.toContain('input');
    });

    test('includes data-pb-blur rule', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.getElementById('pb-blur-styles').textContent).toContain('[data-pb-blur]');
    });

    test('frosted mode uses SVG filter URL', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, 'frosted');
      expect(document.getElementById('pb-blur-styles').textContent).toContain('url(#pb-frosted-filter)');
    });

    test('calling twice replaces previous', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      pb.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.querySelectorAll('#pb-blur-styles').length).toBe(1);
    });

    test('removeBlurRules removes style', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      pb.BlurEngine.removeBlurRules();
      expect(document.getElementById('pb-blur-styles')).toBeNull();
    });

    test('isBlurAllActive reflects state', () => {
      expect(pb.BlurEngine.isBlurAllActive()).toBe(false);
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(pb.BlurEngine.isBlurAllActive()).toBe(true);
      pb.BlurEngine.removeBlurRules();
      expect(pb.BlurEngine.isBlurAllActive()).toBe(false);
    });

    test('excludes extension UI', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      const css = document.getElementById('pb-blur-styles').textContent;
      expect(css).toContain(':not(#pb-picker-toolbar)');
    });

  });

  describe('blurTextCheckElements', () => {
    test('stamps text-check elements with direct text', () => {
      document.body.innerHTML = '<div>text</div><div></div>';
      pb.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      pb.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, false);
      const divs = document.querySelectorAll('div');
      expect(divs[0].dataset.pbBlur).toBe('1');
      expect(divs[1].dataset.pbBlur).toBeUndefined();
    });

    test('thorough stamps inline elements without text', () => {
      document.body.innerHTML = '<span></span>';
      pb.BlurEngine.blurTextCheckElements({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, true);
      expect(document.querySelector('span').dataset.pbBlur).toBe('1');
    });

    test('thorough does not bypass text gate for structural containers', () => {
      document.body.innerHTML = '<div></div>';
      pb.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, true);
      // Empty div — structural container still requires direct text even in thorough mode
      expect(document.querySelector('div').dataset.pbBlur).toBeUndefined();
    });

    test('structural container with direct text is stamped in any mode', () => {
      document.body.innerHTML = '<div>Direct text</div>';
      pb.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, false);
      expect(document.querySelector('div').dataset.pbBlur).toBe('1');
    });
  });

  describe('tryBlurTextCheck', () => {
    test('stamps text-check with text', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      const div = document.createElement('div');
      div.textContent = 'hello';
      document.body.appendChild(div);
      pb.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.pbBlur).toBe('1');
    });

    test('skips empty', () => {
      pb.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.pbBlur).toBeUndefined();
    });
  });

  describe('applyBlur (picker)', () => {
    test('sets data-pb-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.applyBlur(div);
      expect(div.dataset.pbBlur).toBe('1');
    });

    test('idempotent', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.applyBlur(div);
      pb.BlurEngine.applyBlur(div);
      expect(div.dataset.pbBlur).toBe('1');
    });

    test('null safe', () => {
      expect(() => pb.BlurEngine.applyBlur(null)).not.toThrow();
    });
  });

  describe('removeBlur', () => {
    test('removes data-pb-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.applyBlur(div);
      pb.BlurEngine.removeBlur(div);
      expect(div.dataset.pbBlur).toBeUndefined();
    });

    test('null safe', () => {
      expect(() => pb.BlurEngine.removeBlur(null)).not.toThrow();
    });
  });

  describe('toggleBlur', () => {
    test('toggles on/off', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.toggleBlur(div);
      expect(pb.BlurEngine.isBlurred(div)).toBe(true);
      pb.BlurEngine.toggleBlur(div);
      expect(pb.BlurEngine.isBlurred(div)).toBe(false);
    });
  });

  describe('isBlurred', () => {
    test('true for data-pb-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.applyBlur(div);
      expect(pb.BlurEngine.isBlurred(div)).toBe(true);
    });

    test('true for always-blur tag when rules active', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(pb.BlurEngine.isBlurred(p)).toBe(true);
    });

    test('false for non-blurred', () => {
      expect(pb.BlurEngine.isBlurred(document.createElement('div'))).toBe(false);
    });

    test('false for null', () => {
      expect(pb.BlurEngine.isBlurred(null)).toBe(false);
    });
  });

  describe('unblurAll', () => {
    test('removes rules and data attrs', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      pb.BlurEngine.applyBlur(div);
      pb.BlurEngine.unblurAll();
      expect(pb.BlurEngine.isBlurAllActive()).toBe(false);
      expect(div.dataset.pbBlur).toBeUndefined();
    });
  });

  describe('shouldBlurElement', () => {
    const ALL = { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true };

    test('true for always-blur', () => {
      const p = document.createElement('p');
      p.textContent = 'x';
      document.body.appendChild(p);
      expect(pb.BlurEngine.shouldBlurElement(p, ALL, false)).toBe(true);
    });

    test('false for empty text-check', () => {
      const td = document.createElement('td');
      document.body.appendChild(td);
      expect(pb.BlurEngine.shouldBlurElement(td, ALL, false)).toBe(false);
    });

    test('thorough bypasses gate', () => {
      const td = document.createElement('td');
      document.body.appendChild(td);
      expect(pb.BlurEngine.shouldBlurElement(td, ALL, true)).toBe(true);
    });

    test('false for null', () => {
      expect(pb.BlurEngine.shouldBlurElement(null, ALL, false)).toBe(false);
    });
  });

  describe('CATEGORY_SELECTORS', () => {
    test('frozen with 5 categories', () => {
      expect(Object.isFrozen(pb.BlurEngine.CATEGORY_SELECTORS)).toBe(true);
      expect(Object.keys(pb.BlurEngine.CATEGORY_SELECTORS)).toHaveLength(5);
    });
  });

  describe('matchesActiveCategories', () => {
    test('true for img when media on', () => {
      const img = document.createElement('img');
      expect(pb.BlurEngine.matchesActiveCategories(img, { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false })).toBe(true);
    });

    test('false for img when media off', () => {
      const img = document.createElement('img');
      expect(pb.BlurEngine.matchesActiveCategories(img, { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false })).toBe(false);
    });
  });

  // ── Zone overlay methods ──────────────────────────────────────────────────

  describe('createZoneOverlay', () => {
    test('injects overlay div into document.body', () => {
      const el = pb.BlurEngine.createZoneOverlay({ id: 's_test1', name: 'Sticky 1', x: 10, y: 20, width: 100, height: 50 });
      expect(el).not.toBeNull();
      expect(el.parentNode).toBe(document.body);
      expect(el.dataset.pbZone).toBe('s_test1');
      expect(el.dataset.pbZoneName).toBe('Sticky 1');
    });

    test('sets position styles from coordinates', () => {
      const el = pb.BlurEngine.createZoneOverlay({ id: 's_pos', name: 'S', x: 120, y: 340, width: 400, height: 200 });
      expect(el.style.left).toBe('120px');
      expect(el.style.top).toBe('340px');
      expect(el.style.width).toBe('400px');
      expect(el.style.height).toBe('200px');
    });

    test('has pb-zone-overlay class', () => {
      const el = pb.BlurEngine.createZoneOverlay({ id: 's_cls', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      expect(el.classList.contains('pb-zone-overlay')).toBe(true);
    });

    test('returns null for missing id', () => {
      expect(pb.BlurEngine.createZoneOverlay({ name: 'S', x: 0, y: 0, width: 10, height: 10 })).toBeNull();
      expect(pb.BlurEngine.createZoneOverlay(null)).toBeNull();
    });

    test('replaces existing overlay with same id', () => {
      pb.BlurEngine.createZoneOverlay({ id: 's_dup', name: 'S1', x: 10, y: 10, width: 50, height: 50 });
      const el2 = pb.BlurEngine.createZoneOverlay({ id: 's_dup', name: 'S1b', x: 20, y: 20, width: 60, height: 60 });
      expect(el2.style.left).toBe('20px');
      expect(document.querySelectorAll('[data-pb-zone="s_dup"]').length).toBe(1);
    });
  });

  describe('removeZoneOverlay', () => {
    test('removes overlay from DOM and tracking', () => {
      pb.BlurEngine.createZoneOverlay({ id: 's_rm', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      expect(document.querySelector('[data-pb-zone="s_rm"]')).not.toBeNull();
      pb.BlurEngine.removeZoneOverlay('s_rm');
      expect(document.querySelector('[data-pb-zone="s_rm"]')).toBeNull();
    });

    test('no-op for unknown id', () => {
      expect(() => pb.BlurEngine.removeZoneOverlay('s_nonexistent')).not.toThrow();
    });
  });

  describe('getZoneOverlays', () => {
    test('returns all active overlays', () => {
      pb.BlurEngine.createZoneOverlay({ id: 's_a', name: 'A', x: 0, y: 0, width: 10, height: 10 });
      pb.BlurEngine.createZoneOverlay({ id: 's_b', name: 'B', x: 20, y: 20, width: 10, height: 10 });
      const zones = pb.BlurEngine.getZoneOverlays();
      expect(zones).toHaveLength(2);
    });

    test('returns empty array when none exist', () => {
      expect(pb.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('removeAllZoneOverlays', () => {
    test('removes all overlays', () => {
      pb.BlurEngine.createZoneOverlay({ id: 's_x', name: 'X', x: 0, y: 0, width: 10, height: 10 });
      pb.BlurEngine.createZoneOverlay({ id: 's_y', name: 'Y', x: 20, y: 20, width: 10, height: 10 });
      pb.BlurEngine.removeAllZoneOverlays();
      expect(pb.BlurEngine.getZoneOverlays()).toHaveLength(0);
      expect(document.querySelectorAll('.pb-zone-overlay').length).toBe(0);
    });
  });

  describe('unblurAll cleans zones', () => {
    test('removes zone overlays along with data-pb-blur elements', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      pb.BlurEngine.applyBlur(div);
      pb.BlurEngine.createZoneOverlay({ id: 's_unblur', name: 'S', x: 0, y: 0, width: 10, height: 10 });

      pb.BlurEngine.unblurAll();
      expect(div.dataset.pbBlur).toBeUndefined();
      expect(pb.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('_isExtensionUI excludes zones', () => {
    test('zone overlay not treated as blur target', () => {
      const zone = pb.BlurEngine.createZoneOverlay({ id: 's_excl', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      pb.BlurEngine.applyBlur(zone);
      // applyBlur should be a no-op on extension UI elements
      expect(zone.dataset.pbBlur).toBeUndefined();
    });
  });
});
