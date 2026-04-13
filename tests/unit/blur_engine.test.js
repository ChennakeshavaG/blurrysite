/**
 * tests/unit/blur_engine.test.js
 *
 * Unit tests for src/blur_engine.js — hybrid CSS + data-attribute blur engine.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/blur_engine.js');
const SELECTOR_PATH = path.resolve(__dirname, '../../src/selector_utils.js');

function loadBlurEngine() {
  // SelectorUtils is needed by the high-level applyItem dispatch (dynamic items).
  if (!blsi.SelectorUtils && fs.existsSync(SELECTOR_PATH)) {
    require(SELECTOR_PATH);
  }
  if (blsi.BlurEngine) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    throw new Error('blur_engine.js not found');
  }
}

beforeAll(() => { loadBlurEngine(); });

// Fake Storage + UrlMatcher for blurAll() reconciler tests.
// blurAll() awaits blsi.Storage.{getSettings,getRules,getBlurState,getBlurItems}
// and blsi.UrlMatcher.resolveSettings. Tests mutate `fakeStorage` per case.
const fakeStorage = {
  settings: {
    BLUR_CATEGORIES: { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true },
    BLUR_MODE: 'solid',
    THOROUGH_BLUR: false,
    ENABLED: true,
  },
  rules: [],
  blurState: false,
  items: [],
};

beforeAll(() => {
  blsi.Storage = {
    getSettings: () => Promise.resolve(fakeStorage.settings),
    getRules: () => Promise.resolve(fakeStorage.rules),
    getBlurState: () => Promise.resolve(fakeStorage.blurState),
    getBlurItems: () => Promise.resolve(fakeStorage.items),
  };
  blsi.UrlMatcher = {
    // Pass-through — per-URL rule resolution is tested in url_matcher.test.js.
    resolveSettings: (_url, settings) => settings,
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('#bl-si-blur-styles').forEach(el => el.remove());
  document.querySelectorAll('[data-bl-si-blur]').forEach(el => delete el.dataset.blSiBlur);
  fakeStorage.settings = {
    BLUR_CATEGORIES: { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true },
    BLUR_MODE: 'solid',
    THOROUGH_BLUR: false,
    ENABLED: true,
  };
  fakeStorage.rules = [];
  fakeStorage.blurState = false;
  fakeStorage.items = [];
  jest.clearAllMocks();
});

afterEach(async () => {
  fakeStorage.blurState = false;
  fakeStorage.items = [];
  await blsi.BlurEngine.blurAll();
  blsi.BlurEngine.unblurAll();
});

describe('blsi.BlurEngine', () => {

  describe('injectBlurRules', () => {
    test('creates style element in head', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('style contains always-blur tag selectors', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('h1');
      expect(css).toContain('img');
      expect(css).not.toContain('input');
    });

    test('includes data-bl-si-blur rule', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[data-bl-si-blur]');
    });

    test('frosted mode uses SVG filter URL', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, 'frosted');
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('url(#bl-si-frosted-filter)');
    });

    test('calling twice replaces previous', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      blsi.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false });
      expect(document.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });

    test('removeBlurRules removes style', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      blsi.BlurEngine.removeBlurRules();
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('isBlurAllActive reflects state', () => {
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(true);
      blsi.BlurEngine.removeBlurRules();
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
    });

    test('excludes extension UI', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain(':not(#bl-si-picker-toolbar)');
    });

  });

  describe('blurTextCheckElements', () => {
    test('stamps text-check elements with direct text', () => {
      document.body.innerHTML = '<div>text</div><div></div>';
      blsi.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      blsi.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, false);
      const divs = document.querySelectorAll('div');
      expect(divs[0].dataset.blSiBlur).toBe('1');
      expect(divs[1].dataset.blSiBlur).toBeUndefined();
    });

    test('thorough stamps inline elements without text', () => {
      document.body.innerHTML = '<span></span>';
      blsi.BlurEngine.blurTextCheckElements({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, true);
      expect(document.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('thorough does not bypass text gate for structural containers', () => {
      document.body.innerHTML = '<div></div>';
      blsi.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, true);
      // Empty div — structural container still requires direct text even in thorough mode
      expect(document.querySelector('div').dataset.blSiBlur).toBeUndefined();
    });

    test('structural container with direct text is stamped in any mode', () => {
      document.body.innerHTML = '<div>Direct text</div>';
      blsi.BlurEngine.blurTextCheckElements({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true }, false);
      expect(document.querySelector('div').dataset.blSiBlur).toBe('1');
    });
  });

  describe('tryBlurTextCheck', () => {
    test('stamps text-check with text', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      const div = document.createElement('div');
      div.textContent = 'hello';
      document.body.appendChild(div);
      blsi.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('skips empty', () => {
      blsi.BlurEngine.injectBlurRules({ TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true });
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });
  });

  describe('applyBlur (picker)', () => {
    test('sets data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('idempotent', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      blsi.BlurEngine.applyBlur(div);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('null safe', () => {
      expect(() => blsi.BlurEngine.applyBlur(null)).not.toThrow();
    });
  });

  describe('removeBlur', () => {
    test('removes data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      blsi.BlurEngine.removeBlur(div);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });

    test('null safe', () => {
      expect(() => blsi.BlurEngine.removeBlur(null)).not.toThrow();
    });
  });

  describe('toggleBlur', () => {
    test('toggles on/off', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.toggleBlur(div);
      expect(blsi.BlurEngine.isBlurred(div)).toBe(true);
      blsi.BlurEngine.toggleBlur(div);
      expect(blsi.BlurEngine.isBlurred(div)).toBe(false);
    });
  });

  describe('isBlurred', () => {
    test('true for data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      expect(blsi.BlurEngine.isBlurred(div)).toBe(true);
    });

    test('true for always-blur tag when rules active', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      expect(blsi.BlurEngine.isBlurred(p)).toBe(true);
    });

    test('false for non-blurred', () => {
      expect(blsi.BlurEngine.isBlurred(document.createElement('div'))).toBe(false);
    });

    test('false for null', () => {
      expect(blsi.BlurEngine.isBlurred(null)).toBe(false);
    });
  });

  describe('unblurAll', () => {
    test('removes rules and data attrs', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.injectBlurRules({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false });
      blsi.BlurEngine.applyBlur(div);
      blsi.BlurEngine.unblurAll();
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });
  });

  describe('shouldBlurElement', () => {
    const ALL = { TEXT: true, MEDIA: true, FORM: true, TABLE: true, STRUCTURE: true };

    test('true for always-blur', () => {
      const p = document.createElement('p');
      p.textContent = 'x';
      document.body.appendChild(p);
      expect(blsi.BlurEngine.shouldBlurElement(p, ALL, false)).toBe(true);
    });

    test('false for empty text-check', () => {
      const td = document.createElement('td');
      document.body.appendChild(td);
      expect(blsi.BlurEngine.shouldBlurElement(td, ALL, false)).toBe(false);
    });

    test('thorough bypasses gate', () => {
      const td = document.createElement('td');
      document.body.appendChild(td);
      expect(blsi.BlurEngine.shouldBlurElement(td, ALL, true)).toBe(true);
    });

    test('false for null', () => {
      expect(blsi.BlurEngine.shouldBlurElement(null, ALL, false)).toBe(false);
    });
  });

  describe('CATEGORY_SELECTORS', () => {
    test('frozen with 5 categories', () => {
      expect(Object.isFrozen(blsi.BlurEngine.CATEGORY_SELECTORS)).toBe(true);
      expect(Object.keys(blsi.BlurEngine.CATEGORY_SELECTORS)).toHaveLength(5);
    });
  });

  describe('matchesActiveCategories', () => {
    test('true for img when media on', () => {
      const img = document.createElement('img');
      expect(blsi.BlurEngine.matchesActiveCategories(img, { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false })).toBe(true);
    });

    test('false for img when media off', () => {
      const img = document.createElement('img');
      expect(blsi.BlurEngine.matchesActiveCategories(img, { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false })).toBe(false);
    });
  });

  // ── Zone overlay methods ──────────────────────────────────────────────────

  describe('createZoneOverlay', () => {
    test('injects overlay div into document.body', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_test1', name: 'Sticky 1', x: 10, y: 20, width: 100, height: 50 });
      expect(el).not.toBeNull();
      expect(el.parentNode).toBe(document.body);
      expect(el.dataset.blSiZone).toBe('s_test1');
      expect(el.dataset.blSiZoneName).toBe('Sticky 1');
    });

    test('sets position styles from coordinates', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_pos', name: 'S', x: 120, y: 340, width: 400, height: 200 });
      expect(el.style.left).toBe('120px');
      expect(el.style.top).toBe('340px');
      expect(el.style.width).toBe('400px');
      expect(el.style.height).toBe('200px');
    });

    test('has bl-si-zone-overlay class', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_cls', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      expect(el.classList.contains('bl-si-zone-overlay')).toBe(true);
    });

    test('returns null for missing id', () => {
      expect(blsi.BlurEngine.createZoneOverlay({ name: 'S', x: 0, y: 0, width: 10, height: 10 })).toBeNull();
      expect(blsi.BlurEngine.createZoneOverlay(null)).toBeNull();
    });

    test('replaces existing overlay with same id', () => {
      blsi.BlurEngine.createZoneOverlay({ id: 's_dup', name: 'S1', x: 10, y: 10, width: 50, height: 50 });
      const el2 = blsi.BlurEngine.createZoneOverlay({ id: 's_dup', name: 'S1b', x: 20, y: 20, width: 60, height: 60 });
      expect(el2.style.left).toBe('20px');
      expect(document.querySelectorAll('[data-bl-si-zone="s_dup"]').length).toBe(1);
    });

    test('defaults to page anchor when anchor is omitted', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_def', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      expect(el.style.position).toBe('absolute');
      expect(el.dataset.blSiZoneAnchor).toBe('page');
    });

    test('page anchor uses position: absolute', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_page', name: 'S', anchor: 'page', x: 0, y: 0, width: 10, height: 10 });
      expect(el.style.position).toBe('absolute');
      expect(el.dataset.blSiZoneAnchor).toBe('page');
    });

    test('screen anchor uses position: fixed', () => {
      const el = blsi.BlurEngine.createZoneOverlay({ id: 's_scr', name: 'S', anchor: 'screen', x: 0, y: 0, width: 10, height: 10 });
      expect(el.style.position).toBe('fixed');
      expect(el.dataset.blSiZoneAnchor).toBe('screen');
    });
  });

  describe('removeZoneOverlay', () => {
    test('removes overlay from DOM and tracking', () => {
      blsi.BlurEngine.createZoneOverlay({ id: 's_rm', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      expect(document.querySelector('[data-bl-si-zone="s_rm"]')).not.toBeNull();
      blsi.BlurEngine.removeZoneOverlay('s_rm');
      expect(document.querySelector('[data-bl-si-zone="s_rm"]')).toBeNull();
    });

    test('no-op for unknown id', () => {
      expect(() => blsi.BlurEngine.removeZoneOverlay('s_nonexistent')).not.toThrow();
    });
  });

  describe('getZoneOverlays', () => {
    test('returns all active overlays', () => {
      blsi.BlurEngine.createZoneOverlay({ id: 's_a', name: 'A', x: 0, y: 0, width: 10, height: 10 });
      blsi.BlurEngine.createZoneOverlay({ id: 's_b', name: 'B', x: 20, y: 20, width: 10, height: 10 });
      const zones = blsi.BlurEngine.getZoneOverlays();
      expect(zones).toHaveLength(2);
    });

    test('returns empty array when none exist', () => {
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('removeAllZoneOverlays', () => {
    test('removes all overlays', () => {
      blsi.BlurEngine.createZoneOverlay({ id: 's_x', name: 'X', x: 0, y: 0, width: 10, height: 10 });
      blsi.BlurEngine.createZoneOverlay({ id: 's_y', name: 'Y', x: 20, y: 20, width: 10, height: 10 });
      blsi.BlurEngine.removeAllZoneOverlays();
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
      expect(document.querySelectorAll('.bl-si-zone-overlay').length).toBe(0);
    });
  });

  describe('unblurAll cleans zones', () => {
    test('removes zone overlays along with data-bl-si-blur elements', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      blsi.BlurEngine.createZoneOverlay({ id: 's_unblur', name: 'S', x: 0, y: 0, width: 10, height: 10 });

      blsi.BlurEngine.unblurAll();
      expect(div.dataset.blSiBlur).toBeUndefined();
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('_isExtensionUI excludes zones', () => {
    test('zone overlay not treated as blur target', () => {
      const zone = blsi.BlurEngine.createZoneOverlay({ id: 's_excl', name: 'S', x: 0, y: 0, width: 10, height: 10 });
      blsi.BlurEngine.applyBlur(zone);
      // applyBlur should be a no-op on extension UI elements
      expect(zone.dataset.blSiBlur).toBeUndefined();
    });
  });

  // ─── blurAll() reconciler: item handling ──────────────────────────────────
  describe('blurAll — item reconcile', () => {
    beforeEach(() => {
      blsi.BlurEngine.resetCounters();
    });

    test('applies dynamic items from storage', async () => {
      document.body.innerHTML = '<div id="target">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#target' }];
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('target').dataset.blSiBlur).toBe('1');
    });

    test('removes items no longer in storage', async () => {
      document.body.innerHTML = '<div id="rm">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#rm' }];
      await blsi.BlurEngine.blurAll();
      fakeStorage.items = [];
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('rm').dataset.blSiBlur).toBeUndefined();
    });

    test('creates zone overlay for sticky items', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_1', name: 'Sticky 1',
        x: 10, y: 20, width: 100, height: 50,
      }];
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(1);
    });

    test('removes zone overlay when sticky drops from storage', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_r', name: 'Sticky 1',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.BlurEngine.blurAll();
      fakeStorage.items = [];
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });

    test('sticky with path mismatch is skipped', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_p', name: 'Sticky 1',
        x: 0, y: 0, width: 10, height: 10,
        path: '/some/other/page',
      }];
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });

    test('second call is idempotent when storage unchanged', async () => {
      document.body.innerHTML = '<div id="idem">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#idem' }];
      await blsi.BlurEngine.blurAll();
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('idem').dataset.blSiBlur).toBe('1');
    });
  });

  describe('counters', () => {
    beforeEach(() => {
      blsi.BlurEngine.resetCounters();
    });

    test('allocateDynamicName increments', () => {
      expect(blsi.BlurEngine.allocateDynamicName()).toBe('Dynamic 1');
      expect(blsi.BlurEngine.allocateDynamicName()).toBe('Dynamic 2');
    });

    test('allocateStickyName increments', () => {
      expect(blsi.BlurEngine.allocateStickyName()).toBe('Sticky 1');
      expect(blsi.BlurEngine.allocateStickyName()).toBe('Sticky 2');
    });

    test('resetCounters zeroes both', () => {
      blsi.BlurEngine.allocateDynamicName();
      blsi.BlurEngine.allocateStickyName();
      blsi.BlurEngine.resetCounters();
      expect(blsi.BlurEngine.allocateDynamicName()).toBe('Dynamic 1');
      expect(blsi.BlurEngine.allocateStickyName()).toBe('Sticky 1');
    });

    test('blurAll seeds dynamic counter from item name (high-water mark)', async () => {
      document.body.innerHTML = '<div id="seed">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 5', selector: '#seed' }];
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.allocateDynamicName()).toBe('Dynamic 6');
    });

    test('blurAll seeds sticky counter from item name', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_seed', name: 'Sticky 9',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.allocateStickyName()).toBe('Sticky 10');
    });
  });

  // ─── blurAll() reconciler: page-wide blur-all handling ────────────────────
  describe('blurAll — page-wide reconcile', () => {
    test('storage blurState=true injects rules and flips isPageBlurred', async () => {
      fakeStorage.blurState = true;
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.isPageBlurred).toBe(true);
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('storage blurState=false after being true tears down rules', async () => {
      fakeStorage.blurState = true;
      await blsi.BlurEngine.blurAll();
      fakeStorage.blurState = false;
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('no page-wide rules when blurState=false from the start', async () => {
      fakeStorage.blurState = false;
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('category change between calls rebuilds rules', async () => {
      fakeStorage.blurState = true;
      fakeStorage.settings.BLUR_CATEGORIES = { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false };
      await blsi.BlurEngine.blurAll();
      fakeStorage.settings.BLUR_CATEGORIES = { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false };
      await blsi.BlurEngine.blurAll();
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('img');
      expect(css).not.toContain('h1');
    });

    test('THOROUGH_BLUR true → false un-stamps elements no longer matching', async () => {
      // Empty span — non-structural text-check tag with no meaningful text.
      // Thorough=true bypasses the text gate and stamps it; thorough=false
      // requires text content and leaves it alone.
      document.body.innerHTML = '<span id="empty"></span>';
      fakeStorage.blurState = true;
      fakeStorage.settings.THOROUGH_BLUR = true;
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('empty').dataset.blSiBlur).toBeDefined();

      fakeStorage.settings.THOROUGH_BLUR = false;
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('empty').dataset.blSiBlur).toBeUndefined();
    });

    test('narrowing categories un-stamps old matches while blur-all active', async () => {
      document.body.innerHTML = '<h1 id="h">x</h1><img id="i" src="x">';
      fakeStorage.blurState = true;
      fakeStorage.settings.BLUR_CATEGORIES = { TEXT: true, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false };
      await blsi.BlurEngine.blurAll();

      fakeStorage.settings.BLUR_CATEGORIES = { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false };
      await blsi.BlurEngine.blurAll();
      // h1 now comes from the style rules — after category switch the rule
      // no longer matches. Verify the rule set reflects the new categories.
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).not.toContain('h1');
      expect(css).toContain('img');
    });

    test('picker items survive page-wide refresh', async () => {
      document.body.innerHTML = '<div id="pick">x</div>';
      fakeStorage.blurState = true;
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#pick' }];
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('pick').dataset.blSiBlur).toBeDefined();

      // Trigger a refresh by flipping THOROUGH_BLUR — _enablePageWide nukes
      // all stamps, item reconcile must restore picker stamps.
      fakeStorage.settings.THOROUGH_BLUR = true;
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('pick').dataset.blSiBlur).toBeDefined();
    });

    test('ENABLED=false tears everything down', async () => {
      document.body.innerHTML = '<div id="gone">x</div>';
      fakeStorage.blurState = true;
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#gone' }];
      await blsi.BlurEngine.blurAll();
      fakeStorage.settings.ENABLED = false;
      await blsi.BlurEngine.blurAll();
      expect(blsi.BlurEngine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
      expect(document.getElementById('gone').dataset.blSiBlur).toBeUndefined();
    });

    test('ENABLED=false removes zone overlays', async () => {
      fakeStorage.blurState = true;
      fakeStorage.items = [
        { type: 'sticky', id: 'z1', name: 'Sticky 1', anchor: 'page', x: 0, y: 0, width: 100, height: 100 },
      ];
      await blsi.BlurEngine.blurAll();
      expect(document.querySelector('[data-bl-si-zone="z1"]')).not.toBeNull();

      fakeStorage.settings.ENABLED = false;
      await blsi.BlurEngine.blurAll();
      expect(document.querySelector('[data-bl-si-zone]')).toBeNull();
      expect(blsi.BlurEngine.getZoneOverlays().length).toBe(0);
    });

    test('_setPickerActiveForObserver is exposed', () => {
      expect(typeof blsi.BlurEngine._setPickerActiveForObserver).toBe('function');
      blsi.BlurEngine._setPickerActiveForObserver(true);
      blsi.BlurEngine._setPickerActiveForObserver(false);
    });

    test('frosted SVG filter is cleaned up on disable', async () => {
      fakeStorage.blurState = true;
      fakeStorage.settings.BLUR_MODE = 'frosted';
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById(blsi.IDS.SVG_FILTERS)).not.toBeNull();

      fakeStorage.blurState = false;
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById(blsi.IDS.SVG_FILTERS)).toBeNull();
    });

    test('no-op reconcile skips _enablePageWide when nothing page-wide changed', async () => {
      // Stamp a div directly, then run blurAll twice with identical storage.
      // If the second call ran _enablePageWide, the nuke would clear the probe.
      fakeStorage.blurState = true;
      await blsi.BlurEngine.blurAll();
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      await blsi.BlurEngine.blurAll();
      expect(probe.dataset.blSiBlur).toBe('1');
    });

    test('frosted radius change DOES trigger page-wide rebuild', async () => {
      // Counter-test to no-op skip: frosted mode folds BLUR_RADIUS into the
      // reconcile key, so a radius change must force the SVG filter rebuild.
      fakeStorage.blurState = true;
      fakeStorage.settings.BLUR_MODE = 'frosted';
      fakeStorage.settings.BLUR_RADIUS = 6;
      await blsi.BlurEngine.blurAll();
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      fakeStorage.settings.BLUR_RADIUS = 12;
      await blsi.BlurEngine.blurAll();
      // Probe cleared by _enablePageWide nuke — proves the rebuild ran.
      expect(probe.dataset.blSiBlur).toBeUndefined();
    });

    test('sequential awaited blurAll() converges on the final storage state', async () => {
      document.body.innerHTML = '<div id="a">x</div><div id="b">y</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#a' }];
      await blsi.BlurEngine.blurAll();
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 2', selector: '#b' }];
      await blsi.BlurEngine.blurAll();
      expect(document.getElementById('a').dataset.blSiBlur).toBeUndefined();
      expect(document.getElementById('b').dataset.blSiBlur).toBe('1');
    });
  });

  // ─── CATEGORY_SELECTORS coverage — 2026-04 audit additions ────────────────
  describe('category coverage additions', () => {
    const onlyTextCats = { TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false };
    const onlyMediaCats = { TEXT: false, MEDIA: true, FORM: false, TABLE: false, STRUCTURE: false };
    const onlyFormCats = { TEXT: false, MEDIA: false, FORM: true, TABLE: false, STRUCTURE: false };
    const onlyStructCats = { TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: true };

    test('hgroup is stamped when TEXT is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectBlurRules(onlyTextCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('hgroup');
    });

    test('progress and meter are stamped when FORM is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectBlurRules(onlyFormCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('progress');
      expect(css).toContain('meter');
    });

    test('audio is stamped when MEDIA is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectBlurRules(onlyMediaCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('audio');
    });

    test('ruby/rt/rp gated by text content when TEXT is on', () => {
      document.body.innerHTML =
        '<ruby id="ruby-filled">漢<rt id="rt-filled">kan</rt></ruby>' +
        '<ruby id="ruby-empty"></ruby>';
      blsi.BlurEngine.injectBlurRules(onlyTextCats);
      blsi.BlurEngine.blurTextCheckElements({ TEXT: true, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false }, false);
      expect(document.getElementById('ruby-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('rt-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('ruby-empty').dataset.blSiBlur).toBeUndefined();
    });

    test('li stamped when STRUCTURE is on even if TEXT is off (relocation)', () => {
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.BlurEngine.injectBlurRules(onlyStructCats);
      blsi.BlurEngine.blurTextCheckElements(onlyStructCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBe('1');
    });

    test('li NOT stamped when TEXT is on and STRUCTURE is off (relocation)', () => {
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.BlurEngine.injectBlurRules(onlyTextCats);
      blsi.BlurEngine.blurTextCheckElements(onlyTextCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBeUndefined();
    });

    test('dt and dd stamped when STRUCTURE is on (relocation)', () => {
      document.body.innerHTML = '<dl><dt id="term">word</dt><dd id="def">meaning</dd></dl>';
      blsi.BlurEngine.injectBlurRules(onlyStructCats);
      blsi.BlurEngine.blurTextCheckElements(onlyStructCats, false);
      expect(document.getElementById('term').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('def').dataset.blSiBlur).toBe('1');
    });
  });

  // ─── ARIA role coverage — 2026-04 audit addition ──────────────────────────
  describe('ARIA role matching', () => {
    const formOn = { TEXT: false, MEDIA: false, FORM: true, TABLE: false, STRUCTURE: false };
    const formOff = { TEXT: true, MEDIA: true, FORM: false, TABLE: true, STRUCTURE: true };

    test('alwaysBlur CSS rule contains [role="button"] when FORM is on', () => {
      blsi.BlurEngine.injectBlurRules(formOn);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[role="button"]');
      expect(css).toContain('[role="checkbox"]');
      expect(css).toContain('[role="slider"]');
    });

    test('alwaysBlur CSS rule omits role selectors when FORM is off', () => {
      blsi.BlurEngine.injectBlurRules(formOff);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).not.toContain('[role="button"]');
    });

    test('matchesActiveCategories returns true for <div role="button"> when FORM is on', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'button');
      document.body.appendChild(div);
      expect(blsi.BlurEngine.matchesActiveCategories(div, formOn)).toBe(true);
    });

    test('matchesActiveCategories returns false for role="button" when FORM is off', () => {
      // Use an all-off cats so the div doesn't match via STRUCTURE either —
      // this test isolates the role check specifically.
      const allOff = { TEXT: false, MEDIA: false, FORM: false, TABLE: false, STRUCTURE: false };
      const div = document.createElement('div');
      div.setAttribute('role', 'button');
      document.body.appendChild(div);
      expect(blsi.BlurEngine.matchesActiveCategories(div, allOff)).toBe(false);
    });

    test('matchesActiveCategories returns false for plain <div> with no role', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(blsi.BlurEngine.matchesActiveCategories(div, formOn)).toBe(false);
    });

    test('shouldBlurElement returns true for role-matched element', () => {
      const span = document.createElement('span');
      span.setAttribute('role', 'checkbox');
      document.body.appendChild(span);
      expect(blsi.BlurEngine.shouldBlurElement(span, formOn, false)).toBe(true);
    });

    test('role set survives selector cache invalidation (toggle off then on)', () => {
      blsi.BlurEngine.injectBlurRules(formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
      blsi.BlurEngine.injectBlurRules(formOff);
      expect(document.getElementById('bl-si-blur-styles').textContent).not.toContain('[role="button"]');
      blsi.BlurEngine.injectBlurRules(formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
    });
  });
});
