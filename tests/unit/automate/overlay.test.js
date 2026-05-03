/**
 * tests/unit/automate/overlay.test.js
 *
 * Unit tests for src/automate/overlay.js
 * Module exposes blsi.Automate.Overlay with:
 *   init, show, hide, isVisible, destroy
 *
 * Single fixed style: deep frosted (backdrop-filter blur + dark tint). No
 * params, no settings dependency.
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
      blsi.Automate.Overlay.show();
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

    test('z-index sits below the toast (2147483646) and picker toolbar (2147483647)', () => {
      blsi.Automate.Overlay.show();
      expect(document.getElementById(ROOT_ID).style.zIndex).toBe('2147483640');
    });

    test('important markers applied so page CSS cannot disable', () => {
      blsi.Automate.Overlay.show();
      const s = document.getElementById(ROOT_ID).style;
      expect(s.getPropertyPriority('position')).toBe('important');
      expect(s.getPropertyPriority('z-index')).toBe('important');
      expect(s.getPropertyPriority('pointer-events')).toBe('important');
      expect(s.getPropertyPriority('background')).toBe('important');
    });
  });

  describe('frosted style', () => {
    test('applies backdrop-filter: blur(40px) and the -webkit- variant', () => {
      // jsdom drops unknown CSS properties (backdrop-filter not in cssstyle whitelist),
      // so we spy on setProperty to verify the call shape.
      const setPropertySpy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
      try {
        blsi.Automate.Overlay.show();
        const calls = setPropertySpy.mock.calls;
        expect(calls).toEqual(expect.arrayContaining([
          ['backdrop-filter',         'blur(40px)', 'important'],
          ['-webkit-backdrop-filter', 'blur(40px)', 'important'],
        ]));
      } finally {
        setPropertySpy.mockRestore();
      }
    });

    test('applies transparent background (pure frosted — no tint)', () => {
      blsi.Automate.Overlay.show();
      const s = document.getElementById(ROOT_ID).style;
      expect(s.background).toBe('transparent');
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
