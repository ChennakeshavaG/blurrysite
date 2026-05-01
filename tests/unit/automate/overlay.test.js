/**
 * tests/unit/automate/overlay.test.js
 *
 * Unit tests for src/automate/overlay.js
 * Module exposes blsi.Automate.Overlay with:
 *   init, show, update, hide, isVisible, destroy
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/overlay.js');

function freshLoad() {
  delete globalThis.blsi.Automate;
  jest.resetModules();
  require(MODULE_PATH);
}

const ROOT_ID = 'bl-si-automate-overlay';

// USER IMPACT: automate-driven blur shows a single full-viewport curtain — page
// content is hidden without per-element stamping or page-CSS interference.
describe('automate/overlay.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.Overlay.destroy(); } catch (_) {}
  });

  describe('mounting', () => {
    test('init() does not mount any DOM', () => {
      blsi.Automate.Overlay.init();
      expect(document.getElementById(ROOT_ID)).toBeNull();
    });

    test('show() mounts the overlay div with required attributes', () => {
      blsi.Automate.Overlay.show();
      const el = document.getElementById(ROOT_ID);
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('DIV');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.getAttribute('data-bl-si-extension-ui')).toBe('1');
      expect(el.parentNode).toBe(document.body);
    });

    test('show() is idempotent — second call does not duplicate', () => {
      blsi.Automate.Overlay.show();
      blsi.Automate.Overlay.show();
      expect(document.querySelectorAll('#' + ROOT_ID)).toHaveLength(1);
    });

    test('hide() removes the overlay', () => {
      blsi.Automate.Overlay.show();
      blsi.Automate.Overlay.hide();
      expect(document.getElementById(ROOT_ID)).toBeNull();
      expect(blsi.Automate.Overlay.isVisible()).toBe(false);
    });

    test('destroy() removes the overlay + resets state', () => {
      blsi.Automate.Overlay.show({ mode: 'solid', color: '#123456' });
      blsi.Automate.Overlay.destroy();
      expect(document.getElementById(ROOT_ID)).toBeNull();
      // After destroy, show() re-mounts fresh.
      blsi.Automate.Overlay.show();
      expect(document.getElementById(ROOT_ID)).not.toBeNull();
    });
  });

  describe('base styles', () => {
    test('uses fixed positioning covering full viewport', () => {
      blsi.Automate.Overlay.show();
      const s = document.getElementById(ROOT_ID).style;
      expect(s.position).toBe('fixed');
      // jsdom canonicalises bare 0 to 0px for length properties
      expect(s.top).toBe('0px');
      expect(s.right).toBe('0px');
      expect(s.bottom).toBe('0px');
      expect(s.left).toBe('0px');
      expect(s.width).toBe('100vw');
      expect(s.height).toBe('100vh');
    });

    test('z-index sits below the picker toolbar (2147483647)', () => {
      blsi.Automate.Overlay.show();
      expect(document.getElementById(ROOT_ID).style.zIndex).toBe('2147483646');
    });

    test('important markers applied so page CSS cannot disable', () => {
      blsi.Automate.Overlay.show();
      const s = document.getElementById(ROOT_ID).style;
      expect(s.getPropertyPriority('position')).toBe('important');
      expect(s.getPropertyPriority('z-index')).toBe('important');
      expect(s.getPropertyPriority('pointer-events')).toBe('important');
    });
  });

  describe('mode application', () => {
    test("'solid' sets opaque rgba background, no backdrop-filter", () => {
      blsi.Automate.Overlay.show({ mode: 'solid', color: '#000000', opacity: 1 });
      const s = document.getElementById(ROOT_ID).style;
      // jsdom collapses rgba(R,G,B,1) -> rgb(R, G, B)
      expect(s.background).toMatch(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/);
      expect(s.getPropertyValue('backdrop-filter')).toBe('');
    });

    test("'frosted' applies backdrop-filter blur(N) and -webkit- variant", () => {
      // jsdom drops unknown CSS properties (backdrop-filter not in cssstyle whitelist),
      // so we spy on setProperty to verify the call shape.
      const setPropertySpy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
      try {
        blsi.Automate.Overlay.show({ mode: 'frosted', color: '#ffffff', opacity: 0.5, blur_radius: 12 });
        const calls = setPropertySpy.mock.calls;
        expect(calls).toEqual(expect.arrayContaining([
          ['backdrop-filter',         'blur(12px)', 'important'],
          ['-webkit-backdrop-filter', 'blur(12px)', 'important'],
        ]));
      } finally {
        setPropertySpy.mockRestore();
      }
      // Translucent tint applied — opacity 0.5 < 0.6 cap, so passes through
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.5\s*\)/);
    });

    test("'frosted' caps tint alpha at 0.6", () => {
      blsi.Automate.Overlay.show({ mode: 'frosted', color: '#ffffff', opacity: 1 });
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.6\s*\)/);
    });

    test("'color' sets rgba(color, opacity) without backdrop-filter", () => {
      blsi.Automate.Overlay.show({ mode: 'color', color: '#ff0000', opacity: 0.4 });
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*255\s*,\s*0\s*,\s*0\s*,\s*0\.4\s*\)/);
      expect(s.getPropertyValue('backdrop-filter')).toBe('');
    });

    test('invalid hex falls back to rgba(0,0,0,alpha)', () => {
      blsi.Automate.Overlay.show({ mode: 'solid', color: 'not-a-hex', opacity: 0.7 });
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.7\s*\)/);
    });

    test('opacity outside [0,1] is clamped', () => {
      blsi.Automate.Overlay.show({ mode: 'solid', color: '#000000', opacity: 5 });
      let s = document.getElementById(ROOT_ID).style;
      // clamped to 1, jsdom collapses to rgb()
      expect(s.background).toMatch(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/);
      blsi.Automate.Overlay.update({ opacity: -3 });
      s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/);
    });

    test('switching frosted -> solid removes backdrop-filter', () => {
      blsi.Automate.Overlay.show({ mode: 'frosted', blur_radius: 8, opacity: 0.3 });
      blsi.Automate.Overlay.update({ mode: 'solid' });
      const s = document.getElementById(ROOT_ID).style;
      expect(s.getPropertyValue('backdrop-filter')).toBe('');
      expect(s.getPropertyValue('-webkit-backdrop-filter')).toBe('');
    });
  });

  describe('update', () => {
    test('merges options rather than replacing', () => {
      blsi.Automate.Overlay.show({ mode: 'frosted', color: '#ffffff', opacity: 0.4, blur_radius: 8 });
      const setPropertySpy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
      try {
        blsi.Automate.Overlay.update({ blur_radius: 20 });
        expect(setPropertySpy.mock.calls).toEqual(expect.arrayContaining([
          ['backdrop-filter', 'blur(20px)', 'important'],
        ]));
      } finally {
        setPropertySpy.mockRestore();
      }
      // tint kept from initial show
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.4\s*\)/);
    });

    test('update before show mounts the overlay', () => {
      blsi.Automate.Overlay.update({ mode: 'color', color: '#ff0000', opacity: 0.5 });
      const el = document.getElementById(ROOT_ID);
      expect(el).not.toBeNull();
      expect(el.style.background).toMatch(/rgba\(\s*255\s*,\s*0\s*,\s*0\s*,\s*0\.5\s*\)/);
    });
  });

  describe('isVisible', () => {
    test('false initially, true after show, false after hide', () => {
      expect(blsi.Automate.Overlay.isVisible()).toBe(false);
      blsi.Automate.Overlay.show();
      expect(blsi.Automate.Overlay.isVisible()).toBe(true);
      blsi.Automate.Overlay.hide();
      expect(blsi.Automate.Overlay.isVisible()).toBe(false);
    });
  });
});
