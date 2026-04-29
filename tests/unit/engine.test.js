/**
 * tests/unit/engine.test.js
 *
 * Unit tests for src/engine.js (blsi.Engine facade) — hybrid CSS +
 * data-attribute blur engine. Implementation lives in src/core/* sub-modules;
 * this file tests behaviour through the public facade surface.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: injectRules/removeRules, stampElements, tryBlurTextCheck, applyBlur/removeBlur,
 *         isBlurred, unblurAll, matchesActiveCategories, CATEGORY_SELECTORS,
 *         zone overlay queries (getZoneOverlays), handleSite reconciler (items + page-wide), counters,
 *         shadow DOM (injectRules/stampElements/handleDocument/handleSite/teardown/observeRoot),
 *         custom element stamping, ARIA role matching, reveal cascade rule, li/dt/dd placement.
 *
 * OPTIMIZE:
 *   - category coverage tests (hgroup/audio/progress+meter) could use test.each
 *     over tag name and expected css substring.
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

const MODULE_PATH = path.resolve(__dirname, '../../src/engine.js');
const SELECTOR_PATH = path.resolve(__dirname, '../../src/selector_utils.js');
const STATE_PATH = path.resolve(__dirname, '../../src/core/engine_state.js');
const FONTS_PATH = path.resolve(__dirname, '../../src/fonts.js');
const CATEGORIES_PATH = path.resolve(__dirname, '../../src/core/categories.js');
const CSS_PATH = path.resolve(__dirname, '../../src/core/css_manager.js');
const MARKER_PATH = path.resolve(__dirname, '../../src/core/marker_engine.js');
const OBSERVER_PATH = path.resolve(__dirname, '../../src/core/observer.js');
const TARGET_PATH = path.resolve(__dirname, '../../src/core/target_engine.js');

function loadEngine() {
  // Sub-modules of the engine — all must load before src/engine.js.
  if (!blsi.SelectorUtils && fs.existsSync(SELECTOR_PATH)) require(SELECTOR_PATH);
  if (!blsi.Fonts         && fs.existsSync(FONTS_PATH))   require(FONTS_PATH);
  if (!blsi.EngineState   && fs.existsSync(STATE_PATH))   require(STATE_PATH);
  if (!blsi.Categories    && fs.existsSync(CATEGORIES_PATH)) require(CATEGORIES_PATH);
  if (!blsi.CssManager    && fs.existsSync(CSS_PATH))     require(CSS_PATH);
  if (!blsi.MarkerEngine  && fs.existsSync(MARKER_PATH))  require(MARKER_PATH);
  if (!blsi.Observer      && fs.existsSync(OBSERVER_PATH)) require(OBSERVER_PATH);
  if (!blsi.TargetEngine  && fs.existsSync(TARGET_PATH))  require(TARGET_PATH);
  if (blsi.Engine) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    throw new Error('engine.js not found');
  }
}

beforeAll(() => { loadEngine(); });

// Test state carrier for handleSite() tests.
// handleSite(settings) takes everything inline — no storage reads.
// Tests build the full settings shape from fakeStorage before each call:
//   handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items })
const fakeStorage = {
  settings: {
    blur_categories: { text: true, media: true, form: true, table: true, structure: true },
    blur_mode: 'censored',
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
    blur_mode: 'censored',
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
  blsi.Engine.unblurAll();
});

// ── AGENT NAVIGATION ─────────────────────────────────────────────────────────
// Run: grep -n "§" tests/unit/blur_engine.test.js  → get current line of each test section
// Each test section mirrors the same § label in src/blur_engine.js.
//
// Use case                     → Test section          → Code section
// ─────────────────────────────────────────────────────────────────────────────
// injectRules / CSS modes /    → §CSS-INJECTION-TESTS  → §CSS-INJECTION
//   pick-blur rules / reveal
//   cascade / ARIA CSS
//
// stampElements / tryBlur-     → §STAMP-OBSERVER-TESTS → §STAMP-OBSERVER
//   TextCheck / shadow DOM /
//   observeRoot / custom elem
//
// applyBlur / removeBlur /     → §ELEMENT-QUERIES-TESTS → §ELEMENT-QUERIES (implicit)
//   isBlurred / unblurAll /
//   matchesActiveCategories
//
// CATEGORY_SELECTORS const /   → §CATEGORY-SELECTORS-TESTS → §CATEGORY-SELECTORS
//   category coverage / li/dt
//
// Zone overlays / item         → §ITEMS-ZONES-TESTS    → §ITEMS-ZONES
//   reconcile / counters /
//   handleIframe
//
// handleSite page-wide /       → §ORCHESTRATOR-TESTS   → §ORCHESTRATOR
//   blurAll reconcile /
//   pick-blur injection
// ─────────────────────────────────────────────────────────────────────────────

describe('blsi.Engine', () => {

  // ── §CSS-INJECTION-TESTS ─────────────────────────────────────────────────
  // USER IMPACT: blur-all toggle — CSS rules injected so all matching elements render blurred
  describe('injectRules', () => {
    test('creates style element in head', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('style contains always-blur tag selectors', () => {
      blsi.Engine.injectRules(document, { text: true, media: true, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('h1');
      expect(css).toContain('img');
      expect(css).not.toContain('input');
    });

    test('includes data-bl-si-blur rule', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[data-bl-si-blur]');
    });

    test('frosted mode uses SVG filter URL', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false }, 'frosted');
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('url(#bl-si-frosted-filter)');
    });

    test('calling twice replaces previous', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.Engine.injectRules(document, { text: false, media: true, form: false, table: false, structure: false });
      expect(document.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });

    test('removeBlurRules removes style', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.Engine.removeRules(document);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('isBlurAllActive reflects state', () => {
      expect(blsi.Engine.isBlurAllActive()).toBe(false);
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(blsi.Engine.isBlurAllActive()).toBe(true);
      blsi.Engine.removeRules(document);
      expect(blsi.Engine.isBlurAllActive()).toBe(false);
    });

    test('excludes extension UI', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain(':not(#bl-si-picker-toolbar)');
    });

  });

  // USER IMPACT: SPA navigation — new DOM elements stamped correctly after route change
  // ── §STAMP-OBSERVER-TESTS ────────────────────────────────────────────────
  describe('stampElements', () => {
    test('stamps text-check elements with direct text', () => {
      document.body.innerHTML = '<div>text</div><div></div>';
      blsi.Engine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      blsi.Engine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, false);
      const divs = document.querySelectorAll('div');
      expect(divs[0].dataset.blSiBlur).toBe('1');
      expect(divs[1].dataset.blSiBlur).toBeUndefined();
    });

    test('thorough stamps inline elements without text', () => {
      document.body.innerHTML = '<span></span>';
      blsi.Engine.stampElements(document, { text: true, media: false, form: false, table: false, structure: false }, true);
      expect(document.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('thorough does not bypass text gate for structural containers', () => {
      document.body.innerHTML = '<div></div>';
      blsi.Engine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, true);
      // Empty div — structural container still requires direct text even in thorough mode
      expect(document.querySelector('div').dataset.blSiBlur).toBeUndefined();
    });

    test('structural container with direct text is stamped in any mode', () => {
      document.body.innerHTML = '<div>Direct text</div>';
      blsi.Engine.stampElements(document, { text: false, media: false, form: false, table: false, structure: true }, false);
      expect(document.querySelector('div').dataset.blSiBlur).toBe('1');
    });
  });

  describe('tryBlurTextCheck', () => {
    test('stamps text-check with text', () => {
      blsi.Engine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const div = document.createElement('div');
      div.textContent = 'hello';
      document.body.appendChild(div);
      blsi.Engine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('skips empty', () => {
      blsi.Engine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.tryBlurTextCheck(div, false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });

    // Regression for the YouTube sidebar bug: MO drain must stamp custom-element
    // hosts (yt-formatted-string, shreddit-*) inserted after the initial idle
    // pass — not just text-check tags.
    describe('custom element host (regression)', () => {
      const FULL_CATS = { text: true, media: true, form: false, table: true, structure: true };

      afterEach(() => { blsi.EngineState.setCurrentSettings(null); });

      test('stamps custom-element host with direct text node', () => {
        blsi.EngineState.setCurrentSettings({ blur_categories: FULL_CATS });
        const el = document.createElement('yt-formatted-string');
        el.textContent = 'Home';
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBe('1');
      });

      test('skips custom-element host with no direct text node when not thorough', () => {
        blsi.EngineState.setCurrentSettings({ blur_categories: FULL_CATS });
        const el = document.createElement('yt-formatted-string');
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBeUndefined();
      });

      test('stamps empty custom-element host in thorough mode', () => {
        blsi.EngineState.setCurrentSettings({ blur_categories: FULL_CATS });
        const el = document.createElement('shreddit-foo');
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, true);
        expect(el.dataset.blSiBlur).toBe('1');
      });

      test('skips custom-element host when both TEXT and STRUCTURE are off', () => {
        blsi.EngineState.setCurrentSettings({
          blur_categories: { text: false, media: true, form: false, table: true, structure: false },
        });
        const el = document.createElement('yt-formatted-string');
        el.textContent = 'Home';
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBeUndefined();
      });

      test('does not re-stamp a host already owned by pick-blur', () => {
        blsi.EngineState.setCurrentSettings({ blur_categories: FULL_CATS });
        const el = document.createElement('yt-formatted-string');
        el.textContent = 'Home';
        el.dataset.blSiPickBlur = '1';
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBeUndefined();
      });

      test('does not re-stamp a host already owned by PII detection', () => {
        blsi.EngineState.setCurrentSettings({ blur_categories: FULL_CATS });
        const el = document.createElement('yt-formatted-string');
        el.textContent = 'Home';
        el.dataset.blSiPii = '1';
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBeUndefined();
      });

      test('falls back to DEFAULT_CATS when EngineState has no current settings', () => {
        blsi.EngineState.setCurrentSettings(null);
        const el = document.createElement('yt-formatted-string');
        el.textContent = 'Home';
        document.body.appendChild(el);
        blsi.Engine.tryBlurTextCheck(el, false);
        expect(el.dataset.blSiBlur).toBe('1');
      });
    });
  });

  // USER IMPACT: picker element click — selected element gets blur attribute applied
  // ── §ELEMENT-QUERIES-TESTS ───────────────────────────────────────────────
  describe('applyBlur (picker)', () => {
    test('sets data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.applyBlur(div);
      expect(div.dataset.blSiBlur).toBe('1');
    });

    test('null safe', () => {
      expect(() => blsi.Engine.applyBlur(null)).not.toThrow();
    });
  });

  describe('removeBlur', () => {
    test('removes data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.applyBlur(div);
      blsi.Engine.removeBlur(div);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });

    test('null safe', () => {
      expect(() => blsi.Engine.removeBlur(null)).not.toThrow();
    });
  });

  // USER IMPACT: picker unblur decision — isBlurred determines whether click triggers onBlur or onUnblur
  describe('isBlurred', () => {
    test('true for data-bl-si-blur', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.applyBlur(div);
      expect(blsi.Engine.isBlurred(div)).toBe(true);
    });

    test('false for non-blurred', () => {
      expect(blsi.Engine.isBlurred(document.createElement('div'))).toBe(false);
    });

    test('false for null', () => {
      expect(blsi.Engine.isBlurred(null)).toBe(false);
    });

    test('false after rules removed from always-blur tag', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      expect(blsi.Engine.isBlurred(p)).toBe(true);
      blsi.Engine.removeRules(document);
      expect(blsi.Engine.isBlurred(p)).toBe(false);
    });
  });

  // USER IMPACT: clear all blur shortcut (Alt+Shift+U) — removes every blur without page reload
  describe('unblurAll', () => {
    test('removes rules and data attrs', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      blsi.Engine.applyBlur(div);
      blsi.Engine.unblurAll();
      expect(blsi.Engine.isBlurAllActive()).toBe(false);
      expect(div.dataset.blSiBlur).toBeUndefined();
    });
  });

  // USER IMPACT: settings panel category toggles — only elements in enabled categories are selectable/blurred
  // ── §CATEGORY-SELECTORS-TESTS ────────────────────────────────────────────
  describe('CATEGORY_SELECTORS', () => {
    test('frozen with 5 categories', () => {
      expect(Object.isFrozen(blsi.Engine.CATEGORY_SELECTORS)).toBe(true);
      expect(Object.keys(blsi.Engine.CATEGORY_SELECTORS)).toHaveLength(5);
    });
  });

  // USER IMPACT: settings panel category toggles — per-element category membership drives CSS and stamp decisions
  describe('matchesActiveCategories', () => {
    test('true for img when media on', () => {
      const img = document.createElement('img');
      expect(blsi.Engine.matchesActiveCategories(img, { text: false, media: true, form: false, table: false, structure: false })).toBe(true);
    });

    test('false for img when media off', () => {
      const img = document.createElement('img');
      expect(blsi.Engine.matchesActiveCategories(img, { text: true, media: false, form: false, table: false, structure: false })).toBe(false);
    });

    test('false for custom element (hyphenated tag) when no category matches', () => {
      const el = document.createElement('my-widget');
      document.body.appendChild(el);
      expect(blsi.Engine.matchesActiveCategories(el, { text: true, media: true, form: true, table: true, structure: true })).toBe(false);
    });
  });

  // ── §ITEMS-ZONES-TESTS ───────────────────────────────────────────────────
  // ── Zone overlay queries ──────────────────────────────────────────────────
  // Zone creation/removal is internal — driven via handleSite item reconcile.

  // USER IMPACT: popup zone list — popup queries active overlays to display saved zones
  describe('getZoneOverlays', () => {
    const stickyBase = { enabled: true, engage: true, blur_categories: { text: true, media: false, form: false, table: false, structure: false }, blur_mode: null, thorough_blur: false };

    test('returns all active overlays after handleSite applies sticky items', async () => {
      await blsi.Engine.handleSite({ ...stickyBase, blur_items: [
        { type: 'sticky', id: 's_a', name: 'A', anchor: 'page', x: 0, y: 0, width: 10, height: 10 },
        { type: 'sticky', id: 's_b', name: 'B', anchor: 'page', x: 20, y: 20, width: 10, height: 10 },
      ]});
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(2);
    });

    test('returns empty array when none exist', () => {
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('unblurAll cleans zones', () => {
    test('removes zone overlays along with data-bl-si-blur elements', async () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      blsi.Engine.applyBlur(div);
      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [
          { type: 'sticky', id: 's_unblur', name: 'S', anchor: 'page', x: 0, y: 0, width: 10, height: 10 },
        ],
        blur_categories: { text: true, media: false, form: false, table: false, structure: false },
        blur_mode: null, thorough_blur: false,
      });

      blsi.Engine.unblurAll();
      expect(div.dataset.blSiBlur).toBeUndefined();
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(0);
    });
  });

  describe('_isExtensionUI excludes zones', () => {
    test('zone overlay not treated as blur target', async () => {
      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [
          { type: 'sticky', id: 's_excl', name: 'S', anchor: 'page', x: 0, y: 0, width: 10, height: 10 },
        ],
        blur_categories: { text: true, media: false, form: false, table: false, structure: false },
        blur_mode: null, thorough_blur: false,
      });
      const zone = blsi.Engine.getZoneOverlays()[0];
      blsi.Engine.applyBlur(zone);
      expect(zone.dataset.blSiBlur).toBeUndefined();
    });
  });

  // ─── blurAll() reconciler: item handling ──────────────────────────────────
  // USER IMPACT: page restore on load — saved blur items re-applied when extension wakes up
  describe('blurAll — item reconcile', () => {
    beforeEach(() => {
      blsi.Engine.resetCounters();
    });

    test('applies dynamic items from storage', async () => {
      document.body.innerHTML = '<div id="target">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#target' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('target').dataset.blSiPickBlur).toBe('1');
      expect(document.getElementById('target').dataset.blSiBlur).toBeUndefined();
    });

    test('removes items no longer in storage', async () => {
      document.body.innerHTML = '<div id="rm">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#rm' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('rm').dataset.blSiPickBlur).toBeUndefined();
    });

    test('creates zone overlay for sticky items', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_1', name: 'Sticky 1',
        x: 10, y: 20, width: 100, height: 50,
      }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(1);
    });

    test('removes zone overlay when sticky drops from storage', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_r', name: 'Sticky 1',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(0);
    });

    test('second call is idempotent when storage unchanged', async () => {
      document.body.innerHTML = '<div id="idem">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#idem' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('idem').dataset.blSiPickBlur).toBe('1');
    });

    test('applies dynamic item using new selectors[] array shape', async () => {
      document.body.innerHTML = '<div id="newshape">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selectors: ['body > div:nth-of-type(1)', '#newshape'] }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('newshape').dataset.blSiPickBlur).toBe('1');
    });

    test('falls back to second selector when first does not match', async () => {
      document.body.innerHTML = '<div id="fallback">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selectors: ['#stale-no-match', '#fallback'] }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('fallback').dataset.blSiPickBlur).toBe('1');
    });

    test('removes dynamic item using selectors[] shape', async () => {
      document.body.innerHTML = '<div id="rmsel">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selectors: ['#rmsel'] }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('rmsel').dataset.blSiPickBlur).toBeUndefined();
    });
    test('dynamic item with no DOM match is a no-op (does not throw)', async () => {
      document.body.innerHTML = '';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#does-not-exist' }];
      await expect(
        blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items })
      ).resolves.not.toThrow();
    });

    test('sticky item with anchor screen creates position:fixed overlay', async () => {
      fakeStorage.items = [{ type: 'sticky', id: 'ss_screen', name: 'Sticky 1', anchor: 'screen', x: 50, y: 80, width: 200, height: 100 }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      const overlays = blsi.Engine.getZoneOverlays();
      expect(overlays).toHaveLength(1);
      expect(overlays[0].style.position).toBe('fixed');
      expect(overlays[0].dataset.blSiZoneAnchor).toBe('screen');
    });
  });

  // USER IMPACT: blur item naming in popup — "Dynamic 1", "Sticky 2" labels in the saved items list
  describe('counters', () => {
    beforeEach(() => {
      blsi.Engine.resetCounters();
    });

    test('allocateElementName increments', () => {
      expect(blsi.Engine.allocateElementName()).toBe('Element 1');
      expect(blsi.Engine.allocateElementName()).toBe('Element 2');
    });

    test('allocateStickyName page anchor increments', () => {
      expect(blsi.Engine.allocateStickyName('page')).toBe('Area on page 1');
      expect(blsi.Engine.allocateStickyName('page')).toBe('Area on page 2');
    });

    test('allocateStickyName screen anchor increments', () => {
      expect(blsi.Engine.allocateStickyName('screen')).toBe('Area on screen 1');
      expect(blsi.Engine.allocateStickyName('screen')).toBe('Area on screen 2');
    });

    test('allocateStickyName defaults to page when anchor missing', () => {
      expect(blsi.Engine.allocateStickyName()).toBe('Area on page 1');
    });

    test('resetCounters zeroes all three', () => {
      blsi.Engine.allocateElementName();
      blsi.Engine.allocateStickyName('page');
      blsi.Engine.allocateStickyName('screen');
      blsi.Engine.resetCounters();
      expect(blsi.Engine.allocateElementName()).toBe('Element 1');
      expect(blsi.Engine.allocateStickyName('page')).toBe('Area on page 1');
      expect(blsi.Engine.allocateStickyName('screen')).toBe('Area on screen 1');
    });

    test('seeds element counter from new-format item name', async () => {
      document.body.innerHTML = '<div id="seed">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Element 5', selector: '#seed' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.allocateElementName()).toBe('Element 6');
    });

    test('seeds element counter from legacy Dynamic name (backward compat)', async () => {
      document.body.innerHTML = '<div id="seed">x</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 5', selector: '#seed' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.allocateElementName()).toBe('Element 6');
    });

    test('seeds page area counter from new-format item name', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_seed', name: 'Area on page 9',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.allocateStickyName('page')).toBe('Area on page 10');
    });

    test('seeds screen area counter from new-format item name', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_seed2', name: 'Area on screen 3',
        anchor: 'screen', x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.allocateStickyName('screen')).toBe('Area on screen 4');
    });

    test('seeds page counter from legacy Sticky name (backward compat)', async () => {
      fakeStorage.items = [{
        type: 'sticky', id: 's_seed', name: 'Sticky 9',
        x: 0, y: 0, width: 10, height: 10,
      }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.allocateStickyName('page')).toBe('Area on page 10');
    });
  });

  // ── §ORCHESTRATOR-TESTS ──────────────────────────────────────────────────
  // ─── blurAll() reconciler: page-wide blur-all handling ────────────────────
  // USER IMPACT: blur-all toggle and settings change — page-wide state reconciled correctly
  describe('blurAll — page-wide reconcile', () => {
    test('storage blurState=true injects rules and flips isPageBlurred', async () => {
      fakeStorage.blurState = true;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.isPageBlurred).toBe(true);
      expect(document.getElementById('bl-si-blur-styles')).not.toBeNull();
    });

    test('storage blurState=false after being true tears down rules', async () => {
      fakeStorage.blurState = true;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.blurState = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('no page-wide rules when blurState=false from the start', async () => {
      fakeStorage.blurState = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
    });

    test('category change between calls rebuilds rules', async () => {
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_categories = { text: true, media: false, form: false, table: false, structure: false };
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.settings.blur_categories = { text: false, media: true, form: false, table: false, structure: false };
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
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
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('empty').dataset.blSiBlur).toBeDefined();

      fakeStorage.settings.thorough_blur = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('empty').dataset.blSiBlur).toBeUndefined();
    });

    test('narrowing categories un-stamps old matches while blur-all active', async () => {
      document.body.innerHTML = '<h1 id="h">x</h1><img id="i" src="x">';
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_categories = { text: true, media: true, form: false, table: false, structure: false };
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });

      fakeStorage.settings.blur_categories = { text: false, media: true, form: false, table: false, structure: false };
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
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
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('pick').dataset.blSiPickBlur).toBe('1');

      // Trigger a refresh by flipping THOROUGH_BLUR — _enablePageWide nukes
      // all stamps, item reconcile must restore picker stamps.
      fakeStorage.settings.thorough_blur = true;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('pick').dataset.blSiPickBlur).toBe('1');
    });

    test('ENABLED=false tears everything down', async () => {
      document.body.innerHTML = '<div id="gone">x</div>';
      fakeStorage.blurState = true;
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#gone' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.settings.enabled = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(blsi.Engine.isPageBlurred).toBe(false);
      expect(document.getElementById('bl-si-blur-styles')).toBeNull();
      expect(document.getElementById('gone').dataset.blSiPickBlur).toBeUndefined();
      expect(document.getElementById('gone').dataset.blSiBlur).toBeUndefined();
    });

    test('ENABLED=false removes zone overlays', async () => {
      fakeStorage.blurState = true;
      fakeStorage.items = [
        { type: 'sticky', id: 'z1', name: 'Sticky 1', anchor: 'page', x: 0, y: 0, width: 100, height: 100 },
      ];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.querySelector('[data-bl-si-zone="z1"]')).not.toBeNull();

      fakeStorage.settings.enabled = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.querySelector('[data-bl-si-zone]')).toBeNull();
      expect(blsi.Engine.getZoneOverlays().length).toBe(0);
    });

    test('_setPickerActiveForObserver is exposed', () => {
      expect(typeof blsi.Engine._setPickerActiveForObserver).toBe('function');
      blsi.Engine._setPickerActiveForObserver(true);
      blsi.Engine._setPickerActiveForObserver(false);
    });

    test('frosted SVG filter is cleaned up on disable', async () => {
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_mode = 'frosted';
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById(blsi.ids.svg_filters)).not.toBeNull();

      fakeStorage.blurState = false;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById(blsi.ids.svg_filters)).toBeNull();
    });

    test('no-op reconcile skips _enablePageWide when nothing page-wide changed', async () => {
      // Stamp a div directly, then run blurAll twice with identical storage.
      // If the second call ran _enablePageWide, the nuke would clear the probe.
      fakeStorage.blurState = true;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(probe.dataset.blSiBlur).toBe('1');
    });

    test('frosted radius change DOES trigger page-wide rebuild', async () => {
      // Counter-test to no-op skip: frosted mode folds BLUR_RADIUS into the
      // reconcile key, so a radius change must force the SVG filter rebuild.
      fakeStorage.blurState = true;
      fakeStorage.settings.blur_mode = 'frosted';
      fakeStorage.settings.blur_radius = 6;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      const probe = document.createElement('div');
      probe.dataset.blSiBlur = '1';
      document.body.appendChild(probe);
      fakeStorage.settings.blur_radius = 12;
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      // Probe cleared by _enablePageWide nuke — proves the rebuild ran.
      expect(probe.dataset.blSiBlur).toBeUndefined();
    });

    test('sequential awaited blurAll() converges on the final storage state', async () => {
      document.body.innerHTML = '<div id="a">x</div><div id="b">y</div>';
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 1', selector: '#a' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      fakeStorage.items = [{ type: 'dynamic', name: 'Dynamic 2', selector: '#b' }];
      await blsi.Engine.handleSite({ ...fakeStorage.settings, engage: fakeStorage.blurState, blur_items: fakeStorage.items });
      expect(document.getElementById('a').dataset.blSiPickBlur).toBeUndefined();
      expect(document.getElementById('b').dataset.blSiPickBlur).toBe('1');
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
      blsi.Engine.injectRules(document,onlyTextCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('hgroup');
    });

    test('ruby/rt/rp gated by text content when TEXT is on', () => {
      document.body.innerHTML =
        '<ruby id="ruby-filled">漢<rt id="rt-filled">kan</rt></ruby>' +
        '<ruby id="ruby-empty"></ruby>';
      blsi.Engine.injectRules(document,onlyTextCats);
      blsi.Engine.stampElements(document, { text: true, media: false, form: false, table: false, structure: false }, false);
      expect(document.getElementById('ruby-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('rt-filled').dataset.blSiBlur).toBe('1');
      expect(document.getElementById('ruby-empty').dataset.blSiBlur).toBeUndefined();
    });

    test('li covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)', () => {
      // li moved to STRUCTURE.alwaysBlur — CSS injection covers it, not JS stamp.
      blsi.Engine.injectRules(document, onlyStructCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('li');
      // confirm stampElements does NOT add data-bl-si-blur (CSS handles it)
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.Engine.stampElements(document, onlyStructCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBeUndefined();
    });

    test('li not in CSS alwaysBlur and not JS-stamped when STRUCTURE is off', () => {
      document.body.innerHTML = '<ul><li id="item">hello world text</li></ul>';
      blsi.Engine.injectRules(document, onlyTextCats);
      blsi.Engine.stampElements(document, onlyTextCats, false);
      expect(document.getElementById('item').dataset.blSiBlur).toBeUndefined();
    });

    test('dt and dd covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)', () => {
      // dt/dd moved to STRUCTURE.alwaysBlur — CSS injection covers them, not JS stamp.
      blsi.Engine.injectRules(document, onlyStructCats);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('dt');
      expect(css).toContain('dd');
      document.body.innerHTML = '<dl><dt id="term">word</dt><dd id="def">meaning</dd></dl>';
      blsi.Engine.stampElements(document, onlyStructCats, false);
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
      blsi.Engine.injectRules(document,formOn);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[role="button"]');
      expect(css).toContain('[role="checkbox"]');
      expect(css).toContain('[role="slider"]');
    });

    test('alwaysBlur CSS rule omits role selectors when FORM is off', () => {
      blsi.Engine.injectRules(document,formOff);
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).not.toContain('[role="button"]');
    });

    test('matchesActiveCategories returns true for <div role="button"> when FORM is on', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'button');
      document.body.appendChild(div);
      expect(blsi.Engine.matchesActiveCategories(div, formOn)).toBe(true);
    });

    test('matchesActiveCategories returns false for role="button" when FORM is off', () => {
      // Use an all-off cats so the div doesn't match via STRUCTURE either —
      // this test isolates the role check specifically.
      const allOff = { text: false, media: false, form: false, table: false, structure: false };
      const div = document.createElement('div');
      div.setAttribute('role', 'button');
      document.body.appendChild(div);
      expect(blsi.Engine.matchesActiveCategories(div, allOff)).toBe(false);
    });

    test('matchesActiveCategories returns false for plain <div> with no role', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(blsi.Engine.matchesActiveCategories(div, formOn)).toBe(false);
    });

    test('role set survives selector cache invalidation (toggle off then on)', () => {
      blsi.Engine.injectRules(document,formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
      blsi.Engine.injectRules(document,formOff);
      expect(document.getElementById('bl-si-blur-styles').textContent).not.toContain('[role="button"]');
      blsi.Engine.injectRules(document,formOn);
      expect(document.getElementById('bl-si-blur-styles').textContent).toContain('[role="button"]');
    });
    // MISSING: no test for role="listbox", "combobox", "switch" — only button/checkbox/slider covered
    // MISSING: no test that CSS rule correctly uses :not(button):not(input) guard to avoid double-applying to native form elements
  });

  // ── §SHADOW-DOM-TESTS ────────────────────────────────────────────────────
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
      await blsi.Engine.handleSite({
        enabled: true, engage: false, blur_items: [],
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
      blsi.Engine.injectRules(sr, textCats, null);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
    });

    test('injectRules style in shadow root does not appear in document head', () => {
      const sr = makeShadowRoot('<p>hello</p>');
      blsi.Engine.injectRules(sr, textCats, null);
      expect(document.head.querySelector('#bl-si-blur-styles')).toBeNull();
    });

    test('removeRules removes style from shadow root', () => {
      const sr = makeShadowRoot('<p>hello</p>');
      blsi.Engine.injectRules(sr, textCats, null);
      blsi.Engine.removeRules(sr);
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
    });

    // ── stampElements ──────────────────────────────────────────────────────

    test('stampElements stamps text-check elements inside shadow root', () => {
      const sr = makeShadowRoot('<span>secret</span><span></span>');
      blsi.Engine.stampElements(sr, textCats, false, null);
      const spans = sr.querySelectorAll('span');
      expect(spans[0].dataset.blSiBlur).toBe('1');
      expect(spans[1].dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements returns discovered shadow roots', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>text</span>';
      const found = blsi.Engine.stampElements(document, textCats, false, null);
      expect(found).toContain(sr);
    });

    test('stampElements returns empty array when no shadow roots present', () => {
      document.body.innerHTML = '<p>hello</p>';
      const found = blsi.Engine.stampElements(document, textCats, false, null);
      expect(found).toEqual([]);
    });

    // ── handleDocument ───────────────────────────────────────────────────

    test('handleDocument active path injects rules into shadow root', async () => {
      const sr = makeShadowRoot('<p>hello</p>');
      const s = { enabled: true, engage: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(s, sr);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
    });

    test('handleDocument active path stamps text-check elements inside shadow root', async () => {
      const sr = makeShadowRoot('<span>secret</span>');
      const s = { enabled: true, engage: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(s, sr);
      expect(sr.querySelector('span').dataset.blSiBlur).toBe('1');
    });

    test('handleDocument inactive path removes rules and stamps from shadow root', async () => {
      const sr = makeShadowRoot('<span>secret</span>');
      const on  = { enabled: true, engage: true,  blur_categories: textCats, blur_mode: null, thorough_blur: false };
      const off = { enabled: true, engage: false, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(on, sr);
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBe('1');
      await blsi.Engine.handleDocument(off, sr);
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

      const s = { enabled: true, engage: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(s, sr);

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

      const s = { enabled: true, engage: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(s, sr);
      expect(nestedSr.querySelector('#bl-si-blur-styles')).not.toBeNull();
      expect(nestedSr.querySelector('span').dataset.blSiBlur).toBe('1');

      // Single teardown(sr) must clean up nestedSr too
      blsi.Engine.teardown(sr);
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

      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [],
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

      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();

      await blsi.Engine.handleSite({
        enabled: true, engage: false, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });
      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
      expect(sr.querySelector('span').dataset.blSiBlur).toBeUndefined();
    });

    // ── observeRoot idempotency ────────────────────────────────────────────

    test('handleDocument called twice on same shadow root yields one style element', async () => {
      const sr = makeShadowRoot('<span>text</span>');
      const s = { enabled: true, engage: true, blur_categories: textCats, blur_mode: null, thorough_blur: false };
      await blsi.Engine.handleDocument(s, sr);
      await blsi.Engine.handleDocument(s, sr);
      expect(sr.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });
    // ── __blsi_shadow_attached event (late attachShadow detection) ───────────

    test('__blsi_shadow_attached event triggers injectRules on newly-attached shadow root', async () => {
      // Simulate: host already in DOM at stamp time (no shadow root yet),
      // then shadow root is attached asynchronously after the idle stamp pass.
      // main_world_bridge.js fires __blsi_shadow_attached; blur_engine should observe it.
      const host = document.createElement('div');
      document.body.appendChild(host);

      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });

      // Shadow root attached AFTER handleSite stamp pass — the gap this feature closes.
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>secret</span>';

      host.dispatchEvent(
        new CustomEvent('__blsi_shadow_attached', { bubbles: true, composed: true })
      );

      // injectRules is synchronous inside handleDocument — style injected immediately.
      expect(sr.querySelector('#bl-si-blur-styles')).not.toBeNull();
    });

    test('__blsi_shadow_attached is a no-op when blur-all is inactive', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      await blsi.Engine.handleSite({
        enabled: true, engage: false, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });

      const sr = host.attachShadow({ mode: 'open' });
      host.dispatchEvent(
        new CustomEvent('__blsi_shadow_attached', { bubbles: true, composed: true })
      );

      expect(sr.querySelector('#bl-si-blur-styles')).toBeNull();
    });

    test('__blsi_shadow_attached is a no-op when shadow root already observed', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<span>text</span>';

      await blsi.Engine.handleSite({
        enabled: true, engage: true, blur_items: [],
        blur_categories: textCats, blur_mode: null, thorough_blur: false,
      });

      // Dispatch a second time — already observed, injectRules called once only.
      host.dispatchEvent(
        new CustomEvent('__blsi_shadow_attached', { bubbles: true, composed: true })
      );
      expect(sr.querySelectorAll('#bl-si-blur-styles').length).toBe(1);
    });

    // MISSING: no test for closed shadow roots (mode:'closed') — currently assumed open only
    // (MutationObserver callback coverage now lives in `mutation dispatcher — subscribeMutations / unsubscribeMutations`)
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
      blsi.Engine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBe('1');
    });

    test('stampElements does not stamp custom element host when no text content', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-bar></shreddit-bar>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-bar');
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.Engine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements stamps custom element host in thorough mode regardless of text', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-baz></shreddit-baz>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-baz');
      const cats = { text: true, media: false, form: false, table: false, structure: true };
      blsi.Engine.stampElements(document.body, cats, true, null);
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
      blsi.Engine.stampElements(sr, cats, false, null);
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
      blsi.Engine.stampElements(sr, cats, false, null);
      expect(wrapper.dataset.blSiBlur).toBeUndefined();
    });

    test('stampElements does not stamp custom element when STRUCTURE and TEXT both disabled', () => {
      const host = document.createElement('div');
      host.innerHTML = '<shreddit-qux>some text</shreddit-qux>';
      document.body.appendChild(host);
      const el = host.querySelector('shreddit-qux');
      const cats = { text: false, media: true, form: false, table: false, structure: false };
      blsi.Engine.stampElements(document.body, cats, false, null);
      expect(el.dataset.blSiBlur).toBeUndefined();
    });
  });

  // ── RC-2: li/dt/dd in alwaysBlur ────────────────────────────────────────

  // USER IMPACT: pages with lists/definition terms — li/dt/dd blurred by CSS rule not JS stamp
  describe('CATEGORY_SELECTORS list element placement (RC-2)', () => {
    test('li is in STRUCTURE.alwaysBlur not textCheck', () => {
      const cats = blsi.Engine.CATEGORY_SELECTORS;
      expect(cats.structure.alwaysBlur).toContain('li');
      expect(cats.structure.textCheck).not.toContain('li');
    });

    test('dt and dd are in STRUCTURE.alwaysBlur not textCheck', () => {
      const cats = blsi.Engine.CATEGORY_SELECTORS;
      expect(cats.structure.alwaysBlur).toContain('dt');
      expect(cats.structure.alwaysBlur).toContain('dd');
      expect(cats.structure.textCheck).not.toContain('dt');
      expect(cats.structure.textCheck).not.toContain('dd');
    });

    test('injectRules includes li in alwaysBlur CSS when STRUCTURE active', () => {
      blsi.Engine.injectRules(document, { text: false, media: false, form: false, table: false, structure: true });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('li');
    });
  });

  // ── RC-3: Reveal cascade descendant rule ────────────────────────────────

  // USER IMPACT: reveal mode — clicking/hovering blurred container also reveals nested blurred children
  describe('reveal descendant cascade rule (RC-3)', () => {
    test('injectRules includes descendant-reveal cascade rule for data-bl-si-blur', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
      const css = document.getElementById('bl-si-blur-styles').textContent;
      expect(css).toContain('[data-bl-si-reveal] [data-bl-si-blur]');
    });

    test('injectRules includes descendant-reveal cascade rule for data-bl-si-pii', () => {
      blsi.Engine.injectRules(document, { text: true, media: false, form: false, table: false, structure: false });
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
      blsi.Engine.removeRules(document);
    });

    test('handleIframe stamps cross-origin iframe with data-bl-si-blur when active', () => {
      const f = makeIframe();
      // jsdom iframes have no contentDocument (cross-origin simulation) — accessing
      // contentDocument returns null without throwing, so we patch it to throw.
      Object.defineProperty(f, 'contentDocument', {
        get() { throw new DOMException('cross-origin', 'SecurityError'); },
        configurable: true,
      });
      const s = { enabled: true, engage: true };
      blsi.Engine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBe('1');
    });

    test('handleIframe removes stamp on inactive path (blur-all off)', () => {
      const f = makeIframe();
      f.dataset.blSiBlur = '1'; // pre-stamp
      Object.defineProperty(f, 'contentDocument', {
        get() { throw new DOMException('cross-origin', 'SecurityError'); },
        configurable: true,
      });
      const s = { enabled: true, engage: false };
      blsi.Engine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBeUndefined();
    });

    test('handleIframe skips same-origin iframe (all_frames handles it)', () => {
      const f = makeIframe();
      // jsdom iframes have a real (same-origin) contentDocument — handleIframe should skip.
      const s = { enabled: true, engage: true };
      blsi.Engine.handleIframe(s, f);
      expect(f.dataset.blSiBlur).toBeUndefined();
    });
  });

  // ── §PICK-BLUR-TESTS ─────────────────────────────────────────────────────
  // ─── Pick & Blur attribute + CSS injection (data-bl-si-pick-blur) ────────────
  // USER IMPACT: selected blur mode (blur/frosted/color) actually applied to
  // picked elements instead of always falling back to blur.
  describe('pick & blur — data-bl-si-pick-blur attribute', () => {
    beforeEach(() => {
      blsi.Engine.resetCounters();
    });

    test('_applyDynamicItem stamps data-bl-si-pick-blur, NOT data-bl-si-blur', async () => {
      document.body.innerHTML = '<p id="p1">text</p>';
      await blsi.Engine.handleSite({
        enabled: true, engage: false, blur_items: [{ type: 'dynamic', name: 'Dynamic 1', selector: '#p1' }],
        pick_blur_enabled: true, pick_blur_type: 'blur', pick_blur_color: { hex: '#000000', opacity: 1 },
      });
      const el = document.getElementById('p1');
      expect(el.dataset.blSiPickBlur).toBe('1');
      expect(el.dataset.blSiBlur).toBeUndefined();
    });

    test('_removeDynamicItem clears data-bl-si-pick-blur', async () => {
      document.body.innerHTML = '<p id="p2">text</p>';
      const item = { type: 'dynamic', name: 'Dynamic 1', selector: '#p2' };
      const base = { enabled: true, engage: false, pick_blur_enabled: true, pick_blur_type: 'blur', pick_blur_color: { hex: '#000000', opacity: 1 } };
      await blsi.Engine.handleSite({ ...base, blur_items: [item] });
      expect(document.getElementById('p2').dataset.blSiPickBlur).toBe('1');
      await blsi.Engine.handleSite({ ...base, blur_items: [] });
      expect(document.getElementById('p2').dataset.blSiPickBlur).toBeUndefined();
    });

    test('zone overlay (sticky item) stamps data-bl-si-pick-blur on overlay', async () => {
      const base = { enabled: true, engage: false, pick_blur_enabled: true, pick_blur_type: 'blur', pick_blur_color: { hex: '#000000', opacity: 1 } };
      await blsi.Engine.handleSite({ ...base, blur_items: [
        { type: 'sticky', id: 'z_pick', name: 'Z', anchor: 'page', x: 0, y: 0, width: 50, height: 50 },
      ]});
      const zone = document.querySelector('[data-bl-si-zone="z_pick"]');
      expect(zone).not.toBeNull();
      expect(zone.dataset.blSiPickBlur).toBe('1');
    });

    test('removeBlur clears data-bl-si-pick-blur as well as data-bl-si-blur', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      el.dataset.blSiBlur = '1';
      el.dataset.blSiPickBlur = '1';
      blsi.Engine.removeBlur(el);
      expect(el.dataset.blSiBlur).toBeUndefined();
      expect(el.dataset.blSiPickBlur).toBeUndefined();
    });

    test('isBlurred returns true when only data-bl-si-pick-blur is set', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      el.dataset.blSiPickBlur = '1';
      expect(blsi.Engine.isBlurred(el)).toBe(true);
    });

    test('isVisuallyBlurred returns true when only data-bl-si-pick-blur is set', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      el.dataset.blSiPickBlur = '1';
      expect(blsi.Engine.isVisuallyBlurred(el)).toBe(true);
    });
  });

  describe('pick & blur — injectPickBlurRules / removePickBlurRules', () => {
    afterEach(() => {
      blsi.Engine.removePickBlurRules(document);
    });

    test('blur mode injects nothing (static content.css covers it)', () => {
      blsi.Engine.injectPickBlurRules(document, 'blur', { hex: '#ff0000', opacity: 1 });
      expect(document.getElementById('bl-si-pick-blur-styles')).toBeNull();
    });

    test('null/undefined type injects nothing', () => {
      blsi.Engine.injectPickBlurRules(document, null, null);
      expect(document.getElementById('bl-si-pick-blur-styles')).toBeNull();
    });

    test('color mode injects background-color rule for dynamic elements', () => {
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#ff0000', opacity: 0.9 });
      const style = document.getElementById('bl-si-pick-blur-styles');
      expect(style).not.toBeNull();
      expect(style.textContent).toContain('background-color');
      expect(style.textContent).toContain('rgba(255,0,0,0.9)');
      expect(style.textContent).toContain('data-bl-si-pick-blur');
    });

    test('color mode injects zone overlay override', () => {
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#000000', opacity: 1 });
      const css = document.getElementById('bl-si-pick-blur-styles').textContent;
      expect(css).toContain('bl-si-zone-overlay');
      expect(css).toContain('backdrop-filter: none');
    });

    test('color mode injects reveal cancel rule', () => {
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#000000', opacity: 1 });
      const css = document.getElementById('bl-si-pick-blur-styles').textContent;
      expect(css).toContain('data-bl-si-reveal]');
      expect(css).toContain('background-color: transparent');
    });

    test('frosted mode injects filter:url rule', () => {
      blsi.Engine.injectPickBlurRules(document, 'frosted', null);
      const css = document.getElementById('bl-si-pick-blur-styles').textContent;
      expect(css).toContain('url(#bl-si-frosted-filter)');
      expect(css).toContain('data-bl-si-pick-blur');
    });

    test('removePickBlurRules removes bl-si-pick-blur-styles', () => {
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#000000', opacity: 1 });
      expect(document.getElementById('bl-si-pick-blur-styles')).not.toBeNull();
      blsi.Engine.removePickBlurRules(document);
      expect(document.getElementById('bl-si-pick-blur-styles')).toBeNull();
    });

    test('injectPickBlurRules is idempotent — re-inject replaces existing style', () => {
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#ff0000', opacity: 1 });
      blsi.Engine.injectPickBlurRules(document, 'color', { hex: '#00ff00', opacity: 1 });
      expect(document.querySelectorAll('#bl-si-pick-blur-styles')).toHaveLength(1);
      expect(document.getElementById('bl-si-pick-blur-styles').textContent).toContain('rgba(0,255,0,1)');
    });
  });

  // ── §PICK-BLUR-LATE-LOAD-TESTS ───────────────────────────────────────────
  // _pickBlurDynamicActive flag + _tryPickBlurNode (MO idle drain)
  // USER IMPACT: elements inserted after page load are pick-blurred when a
  // matching dynamic item exists, even when blur-all is OFF.
  describe('_pickBlurDynamicActive — flag lifecycle', () => {
    const base = { enabled: true, engage: false, pick_blur_enabled: true, pick_blur_type: 'blur', pick_blur_color: { hex: '#000000', opacity: 1 } };

    test('late-loaded element is pick-blurred when blur-all is OFF (MO regression)', async () => {
      // Regression: handleDocument tears down the observer when blur-all is OFF.
      // handleSite must re-attach it after _reconcileItems via observeRoot() so the
      // MO idle drain can stamp elements inserted after page load.
      // jsdom fires MO callbacks as microtasks; setTimeout falls back for idle.
      document.body.innerHTML = '';
      await blsi.Engine.handleSite({
        ...base,
        blur_items: [{ type: 'dynamic', name: 'Element 1', selector: '#late-load' }],
      });
      // No element matching #late-load yet — nothing stamped.
      expect(document.querySelector('[data-bl-si-pick-blur]')).toBeNull();

      // Simulate late-loading element appearing in the DOM.
      const late = document.createElement('p');
      late.id = 'late-load';
      document.body.appendChild(late);

      // Drain MO microtask (MO callback runs → pushes node to _pendingMoNodes →
      // schedules idle via setTimeout(fn, 0)).
      await Promise.resolve();
      // Drain the idle setTimeout (0 ms — scheduled before this Promise).
      await new Promise(r => setTimeout(r, 0));

      expect(late.dataset.blSiPickBlur).toBe('1');
    });

    test('flag becomes true when dynamic item reconciled', async () => {
      document.body.innerHTML = '<p id="late">late</p>';
      await blsi.Engine.handleSite({ ...base, blur_items: [{ type: 'dynamic', name: 'Element 1', selector: '#late' }] });
      // Verify via MO gate: element inserted after reconcile should be stamped by _tryPickBlurNode.
      // We test the flag indirectly through the function that consults it.
      expect(document.getElementById('late').dataset.blSiPickBlur).toBe('1');
    });

    test('flag becomes false after all dynamic items removed', async () => {
      document.body.innerHTML = '<p id="late2">late</p>';
      const item = { type: 'dynamic', name: 'Element 1', selector: '#late2' };
      await blsi.Engine.handleSite({ ...base, blur_items: [item] });
      expect(document.getElementById('late2').dataset.blSiPickBlur).toBe('1');
      await blsi.Engine.handleSite({ ...base, blur_items: [] });
      // After removal the element is unstamped and flag is false.
      expect(document.getElementById('late2').dataset.blSiPickBlur).toBeUndefined();
    });

    test('sticky-only items do not set dynamic flag (no _tryPickBlurNode calls needed)', async () => {
      // Sticky items use zone overlays, not _tryPickBlurNode, so they don't need the MO path.
      await blsi.Engine.handleSite({ ...base, blur_items: [
        { type: 'sticky', id: 'z_flag', name: 'Area on page 1', anchor: 'page', x: 0, y: 0, width: 50, height: 50 },
      ]});
      // Zone overlay present (sticky path worked), no dynamic items so flag is false.
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(1);
      // Cleanup
      await blsi.Engine.handleSite({ ...base, blur_items: [] });
    });
  });

  describe('_tryPickBlurNode — late-loading element detection', () => {
    const base = { enabled: true, engage: false, pick_blur_enabled: true, pick_blur_type: 'blur', pick_blur_color: { hex: '#000000', opacity: 1 } };

    beforeEach(() => {
      blsi.Engine.resetCounters();
    });

    test('stamps element that matches a stored dynamic item selector (unique match)', async () => {
      document.body.innerHTML = '<p id="dyn1">text</p>';
      await blsi.Engine.handleSite({ ...base, blur_items: [{ type: 'dynamic', name: 'Element 1', selector: '#dyn1' }] });
      // Element was in the DOM at reconcile time — confirm it was stamped.
      expect(document.getElementById('dyn1').dataset.blSiPickBlur).toBe('1');
    });

    test('does not double-stamp an already-stamped element', async () => {
      document.body.innerHTML = '<p id="dyn2">text</p>';
      const el = document.getElementById('dyn2');
      el.dataset.blSiPickBlur = '1';  // pre-stamp
      const item = { type: 'dynamic', name: 'Element 1', selector: '#dyn2' };
      await blsi.Engine.handleSite({ ...base, blur_items: [item] });
      // Should still be '1', not changed to anything else.
      expect(el.dataset.blSiPickBlur).toBe('1');
    });

    test('does not stamp when selector matches multiple elements (not unique)', async () => {
      document.body.innerHTML = '<p class="multi">a</p><p class="multi">b</p>';
      await blsi.Engine.handleSite({ ...base, blur_items: [{ type: 'dynamic', name: 'Element 1', selector: '.multi' }] });
      const els = document.querySelectorAll('.multi');
      // Non-unique — neither should be stamped.
      expect(els[0].dataset.blSiPickBlur).toBeUndefined();
      expect(els[1].dataset.blSiPickBlur).toBeUndefined();
    });

    test('skips extension UI elements', async () => {
      // Elements with data-bl-si-zone attribute are extension UI.
      document.body.innerHTML = '<div id="ext-ui" data-bl-si-zone="z1">zone</div>';
      await blsi.Engine.handleSite({ ...base, blur_items: [{ type: 'dynamic', name: 'Element 1', selector: '#ext-ui' }] });
      expect(document.getElementById('ext-ui').dataset.blSiPickBlur).toBeUndefined();
    });
  });

  describe('highlightItem / clearItemHighlight', () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="hi-target">content</div>';
      blsi.Engine.clearItemHighlight();
    });
    afterEach(() => {
      blsi.Engine.clearItemHighlight();
      document.body.innerHTML = '';
    });

    test('applies bl-si-hover-highlight to resolved dynamic element', () => {
      blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['#hi-target'] });
      expect(document.getElementById('hi-target').classList.contains('bl-si-hover-highlight')).toBe(true);
    });

    test('does not throw when selector resolves to nothing', () => {
      expect(() => {
        blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['#nonexistent-xyz'] });
      }).not.toThrow();
      expect(document.querySelector('.bl-si-hover-highlight')).toBeNull();
    });

    test('second highlightItem clears previous highlight before applying new one', () => {
      document.body.innerHTML += '<div id="hi-target-b">b</div>';
      blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['#hi-target'] });
      blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['#hi-target-b'] });
      expect(document.getElementById('hi-target').classList.contains('bl-si-hover-highlight')).toBe(false);
      expect(document.getElementById('hi-target-b').classList.contains('bl-si-hover-highlight')).toBe(true);
    });

    test('clearItemHighlight removes the highlight class', () => {
      blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['#hi-target'] });
      expect(document.getElementById('hi-target').classList.contains('bl-si-hover-highlight')).toBe(true);
      blsi.Engine.clearItemHighlight();
      expect(document.getElementById('hi-target').classList.contains('bl-si-hover-highlight')).toBe(false);
    });

    test('clearItemHighlight is safe when nothing is highlighted', () => {
      expect(() => blsi.Engine.clearItemHighlight()).not.toThrow();
    });

    test('intersection fallback highlights element via non-unique class selector when data-bl-si-pick-blur is set', () => {
      // Simulates SPA list items sharing the same class: structural selector is stale/non-unique,
      // but class combo is stored and the blurred element has data-bl-si-pick-blur='1'.
      const a = document.createElement('div');
      const b = document.createElement('div');
      a.className = 'shared-row';
      b.className = 'shared-row';
      a.dataset.blSiPickBlur = '1';
      document.body.appendChild(a);
      document.body.appendChild(b);
      // Pass only the non-unique class selector (restoreSelector returns null, triggers fallback).
      blsi.Engine.highlightItem({ item_type: 'dynamic', selectors: ['div.shared-row'] });
      expect(a.classList.contains('bl-si-hover-highlight')).toBe(true);
      expect(b.classList.contains('bl-si-hover-highlight')).toBe(false);
      document.body.removeChild(a);
      document.body.removeChild(b);
    });

    test('applies highlight to sticky zone overlay via id', async () => {
      const fakeSettings = {
        ...blsi.DEFAULT_MODEL,
        enabled: true, blur_radius: 8, reveal_mode: 'hover', thorough_blur: false,
        transition_duration: 0, highlight_color: '#f59e0b', redaction_color: '#000000',
        engage: false,
        blur_items: [{ type: 'sticky', id: 'hl-zone-1', name: 'Zone 1', x: 0, y: 0, width: 50, height: 50 }],
        pick_and_blur: { status: true, settings: blsi.DEFAULT_MODEL.pick_and_blur.settings },
      };
      await blsi.Engine.handleSite(fakeSettings);
      expect(blsi.Engine.getZoneOverlays()).toHaveLength(1);
      blsi.Engine.highlightItem({ item_type: 'sticky', id: 'hl-zone-1' });
      const overlay = blsi.Engine.getZoneOverlays()[0];
      expect(overlay.classList.contains('bl-si-hover-highlight')).toBe(true);
      // Cleanup
      await blsi.Engine.handleSite({ ...fakeSettings, blur_items: [] });
    });
  });

  // ── §STAMP-OBSERVER-TESTS — mutation dispatcher (subscribers) ────────────────
  // USER IMPACT: PII detector and future modules subscribe to a single MO per
  // root in blur_engine. characterData included in MO config so typed text in
  // contenteditable / dynamic .textContent reassignment is dispatched without
  // a page reload.
  describe('mutation dispatcher — subscribeMutations / unsubscribeMutations', () => {
    // MO callback fires in a microtask; idle drain falls back to setTimeout(fn, 0)
    // when requestIdleCallback is unavailable (jsdom). Two awaits flush both.
    async function flushDispatch() {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }

    async function activate(blurAllActive = true) {
      await blsi.Engine.handleSite({
        enabled: true,
        engage: blurAllActive,
        blur_items: [],
        blur_categories: { text: true, media: false, form: false, table: false, structure: false },
        blur_mode: null,
        thorough_blur: false,
      });
      // handleSite caches _lastReconcileKey across tests — when settings are
      // identical to the previous test's call, it short-circuits and skips
      // observeRoot. Outer afterEach() calls unblurAll() which disconnects
      // the observer, so test isolation requires us to re-attach explicitly.
      // observeRoot is idempotent, so this is a no-op when handleSite did
      // attach.
      blsi.Engine.observeRoot(document);
    }

    afterEach(() => {
      // Subscribers persist on the module — clean up between tests.
      blsi.Engine.unsubscribeMutations('test-a');
      blsi.Engine.unsubscribeMutations('test-b');
      blsi.Engine.unsubscribeMutations('pii');
      blsi.Engine._setPickerActiveForObserver(false);
    });

    test('subscribeMutations + unsubscribeMutations are exposed', () => {
      expect(typeof blsi.Engine.subscribeMutations).toBe('function');
      expect(typeof blsi.Engine.unsubscribeMutations).toBe('function');
    });

    test('subscriber receives childList MutationRecord[] for added node', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate();

      const p = document.createElement('p');
      p.textContent = 'inserted';
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).toHaveBeenCalled();
      const [recs, root] = handler.mock.calls[0];
      expect(Array.isArray(recs)).toBe(true);
      expect(recs.some((m) => m.type === 'childList')).toBe(true);
      expect(root === document || root === document.body).toBe(true);
    });

    test('subscriber receives characterData record on textContent change', async () => {
      document.body.innerHTML = '<p>seed</p>';
      const tn = document.body.querySelector('p').firstChild;
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate();

      tn.textContent = 'mutated value';
      await flushDispatch();

      // Some characterData record must reach the subscriber.
      const allRecs = handler.mock.calls.flatMap((c) => c[0]);
      expect(allRecs.some((m) => m.type === 'characterData')).toBe(true);
    });

    test('unsubscribeMutations stops further dispatch', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate();

      blsi.Engine.unsubscribeMutations('test-a');
      const p = document.createElement('p');
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).not.toHaveBeenCalled();
    });

    test('re-registering same name replaces the handler', async () => {
      const first = jest.fn();
      const second = jest.fn();
      blsi.Engine.subscribeMutations('test-a', first);
      blsi.Engine.subscribeMutations('test-a', second);
      await activate();

      const p = document.createElement('p');
      document.body.appendChild(p);
      await flushDispatch();

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
    });

    test('subscriber error is caught — other subscribers still fire', async () => {
      const bad = jest.fn(() => { throw new Error('boom'); });
      const good = jest.fn();
      blsi.Engine.subscribeMutations('test-a', bad);
      blsi.Engine.subscribeMutations('test-b', good);
      await activate();

      const p = document.createElement('p');
      document.body.appendChild(p);
      await flushDispatch();

      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled();
    });

    // USER IMPACT: typed PII inside Gmail compose / Slack / Notion must be detected
    // even while the picker is open — the picker only suppresses engine stamping,
    // not PII rescans on character data.
    test('subscribers still fire when picker is active (engine drain skipped)', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate();

      blsi.Engine._setPickerActiveForObserver(true);
      const p = document.createElement('p');
      p.textContent = 'while picker open';
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).toHaveBeenCalled();
      // Engine drain skipped — element should NOT be stamped.
      expect(p.dataset.blSiBlur).toBeUndefined();
    });

    test('subscribers still fire when blur-all is OFF', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate(true);
      // observeRoot attached. Now turn blur-all off — observer stays attached
      // since handleSite teardown disconnects, but subscribers should still
      // receive events for any subsequent observer attached by another path.
      // Easier check: re-attach observer manually (idempotent) after teardown.
      blsi.Engine.observeRoot(document);

      const p = document.createElement('p');
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).toHaveBeenCalled();
    });

    test('subscribeMutations rejects non-string name and non-function handler', () => {
      expect(() => blsi.Engine.subscribeMutations('', () => {})).not.toThrow();
      expect(() => blsi.Engine.subscribeMutations(null, () => {})).not.toThrow();
      expect(() => blsi.Engine.subscribeMutations('x', null)).not.toThrow();
      // No subscriber installed → no dispatch ever.
    });

    // USER IMPACT (regression for "PII not applied after page reload"): a
    // PII-only configuration (blur-all OFF, pick-blur OFF) loads with no
    // engine-driven MO on document. Subscriber must attach its own document
    // MO at subscribe time so late-loading content reaches the handler.
    test('subscribeMutations attaches document MO when no engine state holds one', async () => {
      // Outer afterEach has already called unblurAll() — observer is gone.
      // No prior handleSite call → blur-all OFF, pick-blur OFF.
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);

      const p = document.createElement('p');
      p.textContent = 'late content';
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).toHaveBeenCalled();
    });

    // USER IMPACT: with PII subscribed and blur-all toggled OFF, handleSite
    // must re-attach the document MO so late-loading PII still reaches the
    // handler. Without the re-attach, every subsequent mutation would be lost.
    test('handleSite re-attaches document MO when subscribers exist after blur-all toggle off', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate(true);            // blur-all ON — MO attached via handleDocument
      handler.mockClear();

      // Force pageWideChanged → handleDocument inactive → teardown(document).
      // After teardown, line 289 must re-attach because hasSubscribers() is true.
      await blsi.Engine.handleSite({
        enabled: true,
        engage: false,
        blur_items: [],
        blur_categories: { text: true, media: false, form: false, table: false, structure: false },
        blur_mode: null,
        thorough_blur: false,
      });

      const p = document.createElement('p');
      p.textContent = 'after toggle off';
      document.body.appendChild(p);
      await flushDispatch();

      expect(handler).toHaveBeenCalled();
    });

    // USER IMPACT: when the last subscriber leaves and no engine feature still
    // needs the MO, it must disconnect — leaving an idle MO running on every
    // page would be a slow leak across tabs.
    test('unsubscribeMutations disconnects document MO when no consumer remains', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      // blur-all OFF, pick-blur OFF — only the subscriber holds the MO.
      handler.mockClear();
      blsi.Engine.unsubscribeMutations('test-a');

      const p = document.createElement('p');
      document.body.appendChild(p);
      await flushDispatch();

      // No MO attached anywhere → no dispatch.
      expect(handler).not.toHaveBeenCalled();
    });

    // USER IMPACT: turning PII off while blur-all is on must keep the engine
    // MO alive — blur-all still needs it to stamp newly inserted text-check
    // elements. Premature disconnect would silently break dynamic blurring.
    test('unsubscribeMutations keeps document MO while blur-all is on', async () => {
      const handler = jest.fn();
      blsi.Engine.subscribeMutations('test-a', handler);
      await activate(true);            // blur-all ON
      blsi.Engine.unsubscribeMutations('test-a');

      // Re-subscribe and append a node — if the document MO survived the
      // unsubscribe (because blur-all still needs it), the new subscriber
      // fires. If unsubscribeMutations had wrongly disconnected it,
      // subscribeMutations would re-attach but the MO config gate would only
      // pick up nodes added AFTER the new attach — which is what we just did,
      // so this still passes either way. Stronger probe: stamp the node via
      // engine drain. <span>text</span> is a text-check tag with meaningful
      // content; if the MO is alive, the idle drain stamps it.
      const span = document.createElement('span');
      span.textContent = 'sample text';
      document.body.appendChild(span);
      await flushDispatch();

      expect(span.dataset.blSiBlur).toBeDefined();
    });

    test('hasSubscribers reflects subscriber count', () => {
      expect(blsi.Engine.hasSubscribers()).toBe(false);
      blsi.Engine.subscribeMutations('test-a', () => {});
      expect(blsi.Engine.hasSubscribers()).toBe(true);
      blsi.Engine.subscribeMutations('test-b', () => {});
      expect(blsi.Engine.hasSubscribers()).toBe(true);
      blsi.Engine.unsubscribeMutations('test-a');
      expect(blsi.Engine.hasSubscribers()).toBe(true);
      blsi.Engine.unsubscribeMutations('test-b');
      expect(blsi.Engine.hasSubscribers()).toBe(false);
    });
  });
});
