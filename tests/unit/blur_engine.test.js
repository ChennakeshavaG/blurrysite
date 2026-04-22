/**
 * tests/unit/blur_engine.test.js
 *
 * Unit tests for src/blur_engine.js — hybrid CSS + data-attribute blur engine.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: injectRules/removeRules, stampElements, tryBlurTextCheck, applyBlur/removeBlur/toggleBlur,
 *         isBlurred, unblurAll, shouldBlurElement, matchesActiveCategories, CATEGORY_SELECTORS,
 *         zone overlay CRUD, handleSite reconciler (items + page-wide), counters,
 *         shadow DOM (injectRules/stampElements/handleDocument/handleSite/teardown/observeRoot),
 *         custom element stamping, ARIA role matching, reveal cascade rule, li/dt/dd placement.
 *
 * REDUNDANT:
 *   - "applyBlur sets data-bl-si-blur" + "applyBlur idempotent": both assert stamp attribute;
 *     idempotent test adds no new assertion beyond checking the value is still '1'.
 *   - "isBlurred true for data-bl-si-blur" + shouldBlurElement "true for always-blur":
 *     both confirm that isBlurred delegates to shouldBlurElement for always-blur tags.
 *   - "defaults to page anchor when anchor omitted" + "page anchor uses position: absolute":
 *     both verify the same default-anchor path; only the zoneData.anchor field differs.
 *   - category coverage "hgroup/progress+meter/audio" tests each verify a single tag in
 *     the CSS output — three nearly identical tests for the same CSS-building logic.
 *
 * OPTIMIZE:
 *   - Zone overlay tests (8 createZoneOverlay tests) share the same zoneData shape;
 *     extract a makeZone(id, overrides) helper to reduce boilerplate.
 *   - ARIA role tests (7 tests) follow identical injectRules→inspect-css or
 *     createElement→setAttribute→matchesActiveCategories patterns; use test.each
 *     over role names and expected boolean outcomes.
 *   - Shadow DOM tests repeat manual host+shadow+innerHTML setup; extract
 *     makeShadowRoot(html) helper (already partially done — extend to nested case too).
 *   - category coverage "hgroup/audio/progress+meter" tests could be one test.each
 *     parameterised over [tag, categories] pairs.
 *
 * MISSING:
 *   - No direct test for ensureSvgFilter() standalone behavior (filter element shape/attrs).
 *   - No test for handleSite mutex — concurrent (non-awaited) calls; second should be dropped.
 *   - No test for MutationObserver callback correctness: observeRoot attaches but mutations
 *     added after attach are never fired and verified in tests.
 *   - No test for observeRoot called on a shadow root (vs document).
 *   - No test for isVisuallyBlurred() (separate from isBlurred).
 * ===*/

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

// Test state carrier for handleSite() tests.
// handleSite(settings) takes everything inline — no storage reads.
// Tests build the full settings shape from fakeStorage before each call:
//   handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items })
const fakeStorage = {
  settings: {
    blur_categories: { text: true, media: true, form: true, table: true, structure: true },
    blur_mode: 'solid',
    thorough_blur: false,
    enabled: true,
  },
  blurState: false,
  items: [],
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('#bl-si-blur-styles').forEach(el => el.remove());
  document.querySelectorAll('[data-bl-si-blur]').forEach(el => delete el.dataset.blSiBlur);
  fakeStorage.settings = {
    blur_categories: { text: true, media: true, form: true, table: true, structure: true },
    blur_mode: 'solid',
    thorough_blur: false,
    enabled: true,
  };
  fakeStorage.blurState = false;
  fakeStorage.items = [];
  jest.clearAllMocks();
});

afterEach(() => {
  fakeStorage.blurState = false;
  fakeStorage.items = [];
  blsi.BlurEngine.unblurAll();
});

describe('blsi.BlurEngine', () => {

  // USER IMPACT: blur-all toggle — CSS rules injected so all matching elements render blurred
  describe('injectRules', () => {
    test('creates style element in head', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('style contains always-blur tag selectors', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: true, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('h1');
      expect(css).toContain('img');
      expect(css).not.toContain('input');
    });

    test('includes data-bl-si-blur rule', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[data-bl-si-blur]');
    });

    test('frosted mode uses SVG filter URL', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false }, 'frosted');
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('url(#bl-si-frosted-filter)');
    });

    test('calling twice replaces previous', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.BlurEngine.injectRules(document, { text: false, media: true, form: false, table: false, structure: false });
      expect(document.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });

    test('removeBlurRules removes style', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.BlurEngine.removeRules(document);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('isBlurAllActive reflects state', () => {
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(true);
      blsi.BlurEngine.removeRules(document);
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
    });

    test('excludes extension UI', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain(':not(#bl-si-picker-toolbar)');
    });

  });

  // USER IMPACT: SPA navigation — new DOM elements stamped correctly after route change
  describe('stampElements', () => {
    test('stamps text-check elements with direct text', () => {
      document.body.innerHTML = '<div>text</div><div></div>';
      blsi.BlurEngine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      blsi.BlurEngine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, false);
      const divs = document.querySelectorAll('div');
      expect(divs[0].dataset.blSiBlur).toBe('1');
      expect(divs[1].dataset.blSiBlur).toBeUndefined();
    });

    test('thorough stamps inline elements without text', () => {
      document.body.innerHTML = '<span></span>';
      blsi.BlurEngine.stampElements(document, { text: true, media: false, form: false, table: false, structure: false }, true);
      expect(document.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('thorough does not bypass text gate for structural containers', () => {
      document.body.innerHTML = '<div></div>';
      blsi.BlurEngine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, true);
      // Empty div — structural container still requires direct text even in thorough mode
      expect(document.querySelector('div').dataset.blSiBlur).toBeUndefined();
    });

    test('structural container with direct text is stamped in any mode', () => {
      document.body.innerHTML = '<div>Direct text</div>';
      blsi.BlurEngine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, false);
      expect(document.querySelector('div').dataset.blSiBlur).toBe('1');
    });
  });

  describe('tryBlurTextCheck', () => {
    test('stamps text-check with text', () => {
      blsi.BlurEngine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const div = document.createElement('div');
      div.textContent = 'hello';
      document.body.appendChild(div);
      blsi.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('skips empty', () => {
      blsi.BlurEngine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });
  });

  // USER IMPACT: picker element click — selected element gets blur attribute applied
  describe('applyBlur (picker)', () => {
    test('sets data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    // REDUNDANT: both this and "sets data-bl-si-blur" assert dataset.blSiBlur === '1'; second call adds no new assertion
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

  // USER IMPACT: picker unblur decision — isBlurred determines whether click triggers onBlur or onUnblur
  describe('isBlurred', () => {
    test('true for data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.applyBlur(div);
      expect(blsi.BlurEngine.isBlurred(div)).toBe(true);
    });

    // REDUNDANT: overlaps with shouldBlurElement "true for always-blur" — both verify the same always-blur tag path
    test('true for always-blur tag when rules active', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(blsi.BlurEngine.isBlurred(p)).toBe(true);
    });

    test('false for non-blurred', () => {
      expect(blsi.BlurEngine.isBlurred(document.createElement('div'))).toBe(false);
    });

    test('false for null', () => {
      expect(blsi.BlurEngine.isBlurred(null)).toBe(false);
    });
    // MISSING: no test for isBlurred returning false after rules removed from an always-blur tag
  });

  // USER IMPACT: clear all blur shortcut (Alt+Shift+U) — removes every blur without page reload
  describe('unblurAll', () => {
    test('removes rules and data attrs', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.BlurEngine.applyBlur(div);
      blsi.BlurEngine.unblurAll();
      expect(blsi.BlurEngine.isBlurAllActive()).toBe(false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });
  });

  // USER IMPACT: blur-all toggle — determines per-element eligibility before stamping
  describe('shouldBlurElement', () => {
    const ALL = { text: true, media: true, form: true, table: true, structure: true };

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
    // MISSING: no test for shouldBlurElement with element whose category is disabled (e.g. img with MEDIA:false)
  });

  // USER IMPACT: settings panel category toggles — only elements in enabled categories are selectable/blurred
  describe('CATEGORY_SELECTORS', () => {
    test('frozen with 5 categories', () => {
      expect(Object.isFrozen(blsi.BlurEngine.CATEGORY_SELECTORS)).toBe(true);
      expect(Object.keys(blsi.BlurEngine.CATEGORY_SELECTORS)).toHaveLength(5);
    });
  });

  // USER IMPACT: settings panel category toggles — per-element category membership drives CSS and stamp decisions
  describe('matchesActiveCategories', () => {
    test('true for img when media on', () => {
      const img = document.createElement('img');
      expect(blsi.BlurEngine.matchesActiveCategories(img, { text: false, media: true, form: false, table: false, structure: false })).toBe(true);
    });

    test('false for img when media off', () => {
      const img = document.createElement('img');
      expect(blsi.BlurEngine.matchesActiveCategories(img, { text: true, media: false, form: false, table: false, structure: false })).toBe(false);
    });
    // MISSING: no test for matchesActiveCategories with a custom element (hyphenated tag name)
    // OPTIMIZE: these two tests follow the same img+category on/off pattern — use test.each([tag, cats, expected])
  });

  // ── Zone overlay methods ──────────────────────────────────────────────────

  // USER IMPACT: sticky picker — zone overlay rendered at correct document/viewport coordinates
  // OPTIMIZE: all createZoneOverlay tests share the same zoneData shape; extract makeZone(id, overrides) helper
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

    // REDUNDANT: same assertions as "defaults to page anchor when anchor is omitted" — only difference is explicit anchor:'page'
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

  // USER IMPACT: sticky picker cleanup — removing a zone removes its overlay from the page
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

  // USER IMPACT: popup zone list — popup queries active overlays to display saved zones
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

  // USER IMPACT: clear all blur — all zone overlays removed from the page in one call
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
  // USER IMPACT: page restore on load — saved blur items re-applied when extension wakes up
  describe('blurAll — item reconcile', () => {
    beforeEach(() => {
      blsi.BlurEngine.resetCounters();
    });

    test('applies dynamic items from storage', async () => {
      document.body.innerHTML = '<div id="target">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#target' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('target').dataset.blSiBlur).toBe('1');
    });

    test('removes items no longer in storage', async () => {
      document.body.innerHTML = '<div id="rm">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#rm' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('rm').dataset.blSiBlur).toBeUndefined();
    });

    test('creates zone overlay for sticky items', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_1', name: 'Sticky 1',
        x: 10, y: 20, width: 100, height: 50,
      }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(1);
    });

    test('removes zone overlay when sticky drops from storage', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_r', name: 'Sticky 1',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });

    test('sticky with path mismatch is skipped', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_p', name: 'Sticky 1',
        x: 0, y: 0, width: 10, height: 10,
        path: '/some/other/page',
      }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.getZoneOverlays()).toHaveLength(0);
    });

    test('second call is idempotent when storage unchanged', async () => {
      document.body.innerHTML = '<div id="idem">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#idem' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('idem').dataset.blSiBlur).toBe('1');
    });
    // MISSING: no test for dynamic item whose selector matches nothing (element not in DOM)
    // MISSING: no test for sticky item with anchor:'screen' (position:fixed overlay)
  });

  // USER IMPACT: blur item naming in popup — "Dynamic 1", "Sticky 2" labels in the saved items list
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
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.allocateDynamicName()).toBe('Dynamic 6');
    });

    test('blurAll seeds sticky counter from item name', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_seed', name: 'Sticky 9',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.allocateStickyName()).toBe('Sticky 10');
    });
  });

  // ─── blurAll() reconciler: page-wide blur-all handling ────────────────────
  // USER IMPACT: blur-all toggle and settings change — page-wide state reconciled correctly
  describe('blurAll — page-wide reconcile', () => {
    test('storage blurState=true injects rules and flips isPageBlurred', async () => {
      fakeStorage.blurState = true;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.isPageBlurred).toBe(true);
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('storage blurState=false after being true tears down rules', async () => {
      fakeStorage.blurState = true;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.blurState = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('no page-wide rules when blurState=false from the start', async () => {
      fakeStorage.blurState = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('category change between calls rebuilds rules', async () => {
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_categories = { text: true, media: false, form: false, table: false, structure: false };
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.settings.blur_categories = { text: false, media: true, form: false, table: false, structure: false };
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
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
      fakeStorage.settings.thorough_blur = true;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('empty').dataset.blSiBlur).toBeDefined();

      fakeStorage.settings.thorough_blur = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('empty').dataset.blSiBlur).toBeUndefined();
    });

    test('narrowing categories un-stamps old matches while blur-all active', async () => {
      document.body.innerHTML = '<h1 id="h">x</h1><img id="i" src="x">';
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_categories = { text: true, media: true, form: false, table: false, structure: false };
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });

      fakeStorage.settings.blur_categories = { text: false, media: true, form: false, table: false, structure: false };
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
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
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('pick').dataset.blSiBlur).toBeDefined();

      // Trigger a refresh by flipping THOROUGH_BLUR — _enablePageWide nukes
      // all stamps, item reconcile must restore picker stamps.
      fakeStorage.settings.thorough_blur = true;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('pick').dataset.blSiBlur).toBeDefined();
    });

    test('ENABLED=false tears everything down', async () => {
      document.body.innerHTML = '<div id="gone">x</div>';
      fakeStorage.blurState = true;
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#gone' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.settings.enabled = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.BlurEngine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
      expect(document.getElementById('gone').dataset.blSiBlur).toBeUndefined();
    });

    test('ENABLED=false removes zone overlays', async () => {
      fakeStorage.blurState = true;
      fakeStorage.items = [
        { type: 'sticky', id: 'z1', name: 'Sticky 1', anchor: 'page', x: 0, y: 0, width: 100, height: 100 },
      ];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.querySelector('[data-bl-si-zone="z1"]')).not.toBeNull();

      fakeStorage.settings.enabled = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
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
      fakeStorage.settings.blur_mode = 'frosted';
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById(blsi.ids.svg_filters)).not.toBeNull();

      fakeStorage.blurState = false;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById(blsi.ids.svg_filters)).toBeNull();
    });

    test('no-op reconcile skips _enablePageWide when nothing page-wide changed', async () => {
      // Stamp a div directly, then run blurAll twice with identical storage.
      // If the second call ran _enablePageWide, the nuke would clear the probe.
      fakeStorage.blurState = true;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(probe.dataset.blSiBlur).toBe('1');
    });

    test('frosted radius change DOES trigger page-wide rebuild', async () => {
      // Counter-test to no-op skip: frosted mode folds BLUR_RADIUS into the
      // reconcile key, so a radius change must force the SVG filter rebuild.
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_mode = 'frosted';
      fakeStorage.settings.blur_radius = 6;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      fakeStorage.settings.blur_radius = 12;
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      // Probe cleared by _enablePageWide nuke — proves the rebuild ran.
      expect(probe.dataset.blSiBlur).toBeUndefined();
    });

    test('sequential awaited blurAll() converges on the final storage state', async () => {
      document.body.innerHTML = '<div id="a">x</div><div id="b">y</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#a' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 2', selector: '#b' }];
      await blsi.BlurEngine.handleSite({ ...fakeStorage.settings, blur_all_active: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('a').dataset.blSiBlur).toBeUndefined();
      expect(document.getElementById('b').dataset.blSiBlur).toBe('1');
    });
  });

  // ─── CATEGORY_SELECTORS coverage — 2026-04 audit additions ────────────────
  // USER IMPACT: settings category toggles — less-common tags (hgroup, audio, ruby, li, dt, dd) blur correctly
  // OPTIMIZE: hgroup/audio/progress+meter tests all call injectRules then css.toContain(tag) — use test.each
  describe('category coverage additions', () => {
    const onlyTextCats = { text: true, media: false, form: false, table: false, structure: false };
    const onlyMediaCats = { text: false, media: true, form: false, table: false, structure: false };
    const onlyFormCats = { text: false, media: false, form: true, table: false, structure: false };
    const onlyStructCats = { text: false, media: false, form: false, table: false, structure: true };

    test('hgroup is stamped when TEXT is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectRules(document,onlyTextCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('hgroup');
    });

    // REDUNDANT: same injectRules→css.toContain pattern as "hgroup" test above
    test('progress and meter are stamped when FORM is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectRules(document,onlyFormCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('progress');
      expect(css).toContain('meter');
    });

    // REDUNDANT: same injectRules→css.toContain pattern as "hgroup" and "progress/meter" tests above
    test('audio is stamped when MEDIA is on (alwaysBlur rule)', () => {
      blsi.BlurEngine.injectRules(document,onlyMediaCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('audio');
    });

    test('ruby/rt/rp gated by text content when TEXT is on', () => {
      document.body.innerHTML =
        '<ruby id="ruby-filled">漢<rt id="rt-filled">kan</rt></ruby>' +
        '<ruby id="ruby-empty"></ruby>';
      blsi.BlurEngine.injectRules(document,onlyTextCats);
      blsi.BlurEngine.stampElements(document, { text: true, media: false, form: false, table: false, structure: false }, false);
      expect(document.getElementById('ruby-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('rt-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('ruby-empty').dataset.blSiBlur).toBeUndefined();
    });

    test('li covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)', () => {
      // li moved to STRUCTURE.alwaysBlur — CSS injection covers it, not JS stamp.
      blsi.BlurEngine.injectRules(document, onlyStructCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('li');
      // confirm stampElements does NOT add data-bl-si-blur (CSS handles it)
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.BlurEngine.stampElements(document, onlyStructCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBeUndefined();
    });

    test('li not in CSS alwaysBlur and not JS-stamped when STRUCTURE is off', () => {
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.BlurEngine.injectRules(document, onlyTextCats);
      blsi.BlurEngine.stampElements(document, onlyTextCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBeUndefined();
    });

    test('dt and dd covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)', () => {
      // dt/dd moved to STRUCTURE.alwaysBlur — CSS injection covers them, not JS stamp.
      blsi.BlurEngine.injectRules(document, onlyStructCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('dt');
      expect(css).toContain('dd');
      document.body.innerHTML = '<dl><dt id="term">word</dt><dd id="def">meaning</dd></dl>';
      blsi.BlurEngine.stampElements(document, onlyStructCats, false);
      expect(document.getElementById('term').dataset.blSiBlur).toBeUndefined();
      expect(document.getElementById('def').dataset.blSiBlur).toBeUndefined();
    });
  });

  // ─── ARIA role coverage — 2026-04 audit addition ──────────────────────────
  // USER IMPACT: GitHub/SPAs with role=button divs — role-based blur rules correct when FORM category toggled
  // OPTIMIZE: matchesActiveCategories tests (role="button" on/off, plain div) follow the same pattern — use test.each
  describe('ARIA role matching', () => {
    const formOn = { text: false, media: false, form: true, table: false, structure: false };
    const formOff = { text: true, media: true, form: false, table: true, structure: true };

    test('alwaysBlur CSS rule contains [role="button"] when FORM is on', () => {
      blsi.BlurEngine.injectRules(document,formOn);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[role="button"]');
      expect(css).toContain('[role="checkbox"]');
      expect(css).toContain('[role="slider"]');
    });

    test('alwaysBlur CSS rule omits role selectors when FORM is off', () => {
      blsi.BlurEngine.injectRules(document,formOff);
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
      const allOff = { text: false, media: false, form: false, table: false, structure: false };
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
      blsi.BlurEngine.injectRules(document,formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
      blsi.BlurEngine.injectRules(document,formOff);
      expect(document.getElementById('bl-si-blur-styles').textContent).not.toContain('[role="button"]');
      blsi.BlurEngine.injectRules(document,formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
    });
    // MISSING: no test for role="listbox", "combobox", "switch" — only button/checkbox/slider covered
    // MISSING: no test that CSS rule correctly uses :not(button):not(input) guard to avoid double-applying to native form elements
  });

  // ─── Shadow DOM support ───────────────────────────────────────────────────
  // Uses jsdom's attachShadow({ mode: 'open' }) to create real shadow roots.
  // Tests exercise the root-aware API (injectRules, removeRules, stampElements,
  // handleDocument, handleSite, teardown) in shadow root scope.
  // USER IMPACT: web component sites (Slack/Discord/Figma) — blur penetrates shadow boundaries
  // OPTIMIZE: manual host+shadow+innerHTML setup repeated in every test; extend the shared makeShadowRoot() helper
  describe('shadow DOM', () => {
    const textCats = { text: true, media: false, form: false, table: false, structure: false };

    // Drive _lastReconcileKey to 'inactive' after each test so that the next
    // handleSite(BLUR_ALL_ACTIVE:true, textCats) call sees pageWideChanged=true.
    // Without this, two consecutive handleSite(active, textCats) calls in
    // adjacent tests skip handleDocument on the second call (key unchanged).
    afterEach(async () => {
      await blsi.BlurEngine.handleSite({
        enabled: true, blur_all_active: false, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });
    });

    // Create a shadow root with given innerHTML on a fresh host in document.body.
    function makeShadowRoot(html) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = html;
      return sr;
    }

    // ── injectRules / removeRules ──────────────────────────────────────────

    test('injectRules injects style into shadow root', () => {
      const sr = makeShadowRoot('<p>hello</p>');
      blsi.BlurEngine.injectRules(sr, textCats, null);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
    });

    test('injectRules style in shadow root does not appear in document head', () => {
      const sr = makeShadowRoot('<p>hello</p>');
      blsi.BlurEngine.injectRules(sr, textCats, null);
      expect(document.head.querySelector('#bl-si-blur-styles')).toBeNull();
    });

    test('removeRules removes style from shadow root', () => {
      const sr = makeShadowRoot('<p>hello</p>');
      blsi.BlurEngine.injectRules(sr, textCats, null);
      blsi.BlurEngine.removeRules(sr);
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
    });

    // ── stampElements ──────────────────────────────────────────────────────

    test('stampElements stamps text-check elements inside shadow root', () => {
      const sr = makeShadowRoot('<span>secret</span><span></span>');
      blsi.BlurEngine.stampElements(sr, textCats, false, null);
      const spans = sr.querySelectorAll('span');
      expect(spans[0].dataset.blSiBlur).toBe('1');
      expect(spans[1].dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements returns discovered shadow roots', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>text</span>';
      const found = blsi.BlurEngine.stampElements(document, textCats, false, null);
      expect(found).toContain(sr);
    });

    test('stampElements returns empty array when no shadow roots present', () => {
      document.body.innerHTML = '<p>hello</p>';
      const found = blsi.BlurEngine.stampElements(document, textCats, false, null);
      expect(found).toEqual([]);
    });

    // ── handleDocument ─────────────────────────────────────────────────────

    test('handleDocument active path injects rules into shadow root', async () => {
      const sr = makeShadowRoot('<p>hello</p>');
      const s = { enabled: true, blur_all_active: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(s, sr);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
    });

    test('handleDocument active path stamps text-check elements inside shadow root', async () => {
      const sr = makeShadowRoot('<span>secret</span>');
      const s = { enabled: true, blur_all_active: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(s, sr);
      expect(sr.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('handleDocument inactive path removes rules and stamps from shadow root', async () => {
      const sr = makeShadowRoot('<span>secret</span>');
      const on  = { enabled: true, blur_all_active: true,  blur_categories: textCats, blur_mode: null, thorough_blur: false };
      const off = { enabled: true, blur_all_active: false, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(on, sr);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBe('1');
      await blsi.BlurEngine.handleDocument(off, sr);
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBeUndefined();
    });

    test('handleDocument recurses into nested shadow roots', async () => {
      // document.body → outerHost → sr → innerHost → nestedSr
      const outerHost = document.createElement('div');
      document.body.appendChild(outerHost);
      const sr = outerHost.attachShadow({ mode: 'open' });
      const innerHost = document.createElement('div');
      sr.appendChild(innerHost);
      const nestedSr = innerHost.attachShadow({ mode: 'open' });
      nestedSr.innerHTML = '<span>nested secret</span>';

      const s = { enabled: true, blur_all_active: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(s, sr);

      expect(nestedSr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(nestedSr.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    // ── teardown ───────────────────────────────────────────────────────────

    test('teardown removes stamps and rules recursively from nested shadow roots', async () => {
      // document.body → outerHost → sr → innerHost → nestedSr
      const outerHost = document.createElement('div');
      document.body.appendChild(outerHost);
      const sr = outerHost.attachShadow({ mode: 'open' });
      const innerHost = document.createElement('div');
      sr.appendChild(innerHost);
      const nestedSr = innerHost.attachShadow({ mode: 'open' });
      nestedSr.innerHTML = '<span>text</span>';

      const s = { enabled: true, blur_all_active: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(s, sr);
      expect(nestedSr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(nestedSr.querySelector('span').dataset.blSiBlur).toBe('1');

      // Single teardown(sr) must clean up nestedSr too
      blsi.BlurEngine.teardown(sr);
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
      expect(nestedSr.querySelector('#bl-si-blur-styles')).toBeNull();
      expect(nestedSr.querySelector('span').dataset.blSiBlur).toBeUndefined();
    });

    // ── handleSite end-to-end ──────────────────────────────────────────────
    // Use textCats + BLUR_MODE:null so reconcileKey differs from fakeStorage
    // defaults (solid + all-cats), guaranteeing pageWideChanged=true regardless
    // of _lastReconcileKey left by prior tests.

    test('handleSite stamps elements inside shadow roots when blur-all active', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>secret content</span>';

      await blsi.BlurEngine.handleSite({
        enabled: true, blur_all_active: true, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });

      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('handleSite cleans up shadow roots when blur-all deactivated', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>secret content</span>';

      await blsi.BlurEngine.handleSite({
        enabled: true, blur_all_active: true, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();

      await blsi.BlurEngine.handleSite({
        enabled: true, blur_all_active: false, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBeUndefined();
    });

    // ── observeRoot idempotency ────────────────────────────────────────────

    test('handleDocument called twice on same shadow root yields one style element', async () => {
      const sr = makeShadowRoot('<span>text</span>');
      const s = { enabled: true, blur_all_active: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.BlurEngine.handleDocument(s, sr);
      await blsi.BlurEngine.handleDocument(s, sr);
      expect(sr.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });
    // MISSING: no test for MutationObserver callback — observeRoot attaches observer but mutations are never triggered/verified
    // MISSING: no test for closed shadow roots (mode:'closed') — currently assumed open only
  });

  // ── RC-1: Custom element host stamping ──────────────────────────────────

  // USER IMPACT: Reddit/Polymer sites using custom elements — shreddit-post and similar hosts stamped correctly
  describe('custom element stamping (RC-1)', () => {
    test('stampElements stamps custom element host when text content present', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-foo>visible content</shreddit-foo>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-foo');
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.BlurEngine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBe('1');
    });

    test('stampElements does not stamp custom element host when no text content', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-bar></shreddit-bar>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-bar');
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.BlurEngine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements stamps custom element host in thorough mode regardless of text', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-baz></shreddit-baz>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-baz');
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.BlurEngine.stampElements(document.body, cats, true, null);
      expect(el.dataset.blSiBlur).toBe('1');
    });

    test('stampElements stamps shadow DOM <a> containing a <slot> (no direct text)', () => {
      // The <a> inside a shadow root has only <slot> as child — no direct text nodes.
      // hasMeaningfulTextContent returns false, but the slot check should stamp it.
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      const anchor = document.createElement('a');
      const slot = document.createElement('slot');
      anchor.appendChild(slot);
      sr.appendChild(anchor);
      const cats = { text: true, media: false, form: false, table: false, structure: false };
      blsi.BlurEngine.stampElements(sr, cats, false, null);
      expect(anchor.dataset.blSiBlur).toBe('1');
    });

    test('stampElements does NOT stamp structural element containing only a slot (text gate still strict)', () => {
      // Structural elements (div) must not be stamped just because they have a <slot> —
      // that would cause nested-blur artifacts on shadow DOM layout wrappers.
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      const wrapper = document.createElement('div');
      const slot = document.createElement('slot');
      wrapper.appendChild(slot);
      sr.appendChild(wrapper);
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.BlurEngine.stampElements(sr, cats, false, null);
      expect(wrapper.dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements does not stamp custom element when STRUCTURE and TEXT both disabled', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-qux>some text</shreddit-qux>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-qux');
      const cats = { text: false, media: true, form: false, table: false, structure: false };
      blsi.BlurEngine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBeUndefined();
    });
  });

  // ── RC-2: li/dt/dd in alwaysBlur ────────────────────────────────────────

  // USER IMPACT: pages with lists/definition terms — li/dt/dd blurred by CSS rule not JS stamp
  describe('CATEGORY_SELECTORS list element placement (RC-2)', () => {
    test('li is in STRUCTURE.alwaysBlur not textCheck', () => {
      const cats = blsi.BlurEngine.CATEGORY_SELECTORS;
      expect(cats.structure.alwaysBlur).toContain('li');
      expect(cats.structure.textCheck).not.toContain('li');
    });

    test('dt and dd are in STRUCTURE.alwaysBlur not textCheck', () => {
      const cats = blsi.BlurEngine.CATEGORY_SELECTORS;
      expect(cats.structure.alwaysBlur).toContain('dt');
      expect(cats.structure.alwaysBlur).toContain('dd');
      expect(cats.structure.textCheck).not.toContain('dt');
      expect(cats.structure.textCheck).not.toContain('dd');
    });

    test('injectRules includes li in alwaysBlur CSS when STRUCTURE active', () => {
      blsi.BlurEngine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('li');
    });
  });

  // ── RC-3: Reveal cascade descendant rule ────────────────────────────────

  // USER IMPACT: reveal mode — clicking/hovering blurred container also reveals nested blurred children
  describe('reveal descendant cascade rule (RC-3)', () => {
    test('injectRules includes descendant-reveal cascade rule for data-bl-si-blur', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[data-bl-si-reveal] [data-bl-si-blur]');
    });

    test('injectRules includes descendant-reveal cascade rule for data-bl-si-pii', () => {
      blsi.BlurEngine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[data-bl-si-reveal] [data-bl-si-pii]');
    });
    // MISSING: no behavioural test confirming the cascade rule actually un-blurs a child element at render time
  });

  // ── RC-4: handleIframe — cross-origin iframe black-box blur ─────────────

  // USER IMPACT: pages with embedded cross-origin iframes (YouTube, etc.) — iframe element
  //              itself gets blurred as an opaque box when blur-all is active.
  describe('handleIframe (RC-4)', () => {
    function makeIframe() {
      const f = document.createElement('iframe');
      document.body.appendChild(f);
      return f;
    }

    beforeEach(() => {
      blsi.BlurEngine.removeRules(document);
    });

    test('handleIframe stamps cross-origin iframe with data-bl-si-blur when active', () => {
      const f = makeIframe();
      // jsdom iframes have no contentDocument (cross-origin simulation) — accessing
      // contentDocument returns null without throwing, so we patch it to throw.
      Object.defineProperty(f, 'contentDocument', {
        get() { throw new DOMException('cross-origin', 'SecurityError'); },
        configurable: true,
      });
      const s = { enabled: true, blur_all_active: true };
      blsi.BlurEngine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBe('1');
    });

    test('handleIframe removes stamp on inactive path (blur-all off)', () => {
      const f = makeIframe();
      f.dataset.blSiBlur = '1'; // pre-stamp
      Object.defineProperty(f, 'contentDocument', {
        get() { throw new DOMException('cross-origin', 'SecurityError'); },
        configurable: true,
      });
      const s = { enabled: true, blur_all_active: false };
      blsi.BlurEngine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBeUndefined();
    });

    test('handleIframe skips same-origin iframe (all_frames handles it)', () => {
      const f = makeIframe();
      // jsdom iframes have a real (same-origin) contentDocument — handleIframe should skip.
      const s = { enabled: true, blur_all_active: true };
      blsi.BlurEngine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBeUndefined();
    });
  });
});
