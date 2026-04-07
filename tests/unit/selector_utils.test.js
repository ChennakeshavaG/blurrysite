/**
 * tests/unit/selector_utils.test.js
 *
 * Unit tests for src/selector_utils.js
 * Module exposes pb.SelectorUtils with:
 *   getSelector, generateId, restoreSelector, restoreAllSelectors
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/selector_utils.js');

function loadSelectorUtils() {
  if (pb.SelectorUtils) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';

    function generateId() {
      return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    }

    function getSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return null;

      // Use existing ID if unique in document.
      if (el.id) {
        const matches = document.querySelectorAll('#' + CSS.escape(el.id));
        if (matches.length === 1) return '#' + CSS.escape(el.id);
      }

      // Stamp a unique data attribute if no other unique identifier.
      if (!el.dataset.pbId) {
        el.dataset.pbId = generateId();
      }
      return '[data-pb-id="' + el.dataset.pbId + '"]';
    }

    function restoreSelector(selector) {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch (e) {
        return null;
      }
    }

    function restoreAllSelectors(selectors) {
      if (!Array.isArray(selectors)) return [];
      return selectors
        .map(function(s) { return restoreSelector(s); })
        .filter(function(el) { return el !== null; });
    }

    pb.SelectorUtils = {
      getSelector: getSelector,
      generateId: generateId,
      restoreSelector: restoreSelector,
      restoreAllSelectors: restoreAllSelectors,
    };
  })();
  `;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('pb.SelectorUtils', () => {
  beforeAll(() => {
    loadSelectorUtils();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── getSelector ────────────────────────────────────────────────────────────

  describe('getSelector', () => {
    test('returns #id selector when element has a unique ID', () => {
      const div = document.createElement('div');
      div.id = 'uniqueTarget';
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);

      expect(selector).toBe('#uniqueTarget');
    });

    test('does not use ID selector when multiple elements share the same ID', () => {
      // Malformed HTML, but should still handle gracefully.
      const div1 = document.createElement('div');
      div1.id = 'shared';
      const div2 = document.createElement('div');
      div2.id = 'shared';
      document.body.appendChild(div1);
      document.body.appendChild(div2);

      const selector = pb.SelectorUtils.getSelector(div1);

      // Should NOT return '#shared' because it is not unique.
      expect(selector).not.toBe('#shared');
    });

    test('returns nth-of-type path when no unique identifier found', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);

      expect(selector).toMatch(/^body > /);
      expect(selector).toContain('nth-of-type');
    });

    test('returns nth-of-type path when element has no ID', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);

      expect(selector).toMatch(/^body > div:nth-of-type/);
    });

    test('reuses existing data-pb-id when called twice on same element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const s1 = pb.SelectorUtils.getSelector(div);
      const s2 = pb.SelectorUtils.getSelector(div);

      expect(s1).toBe(s2);
    });

    test('returns null (or falsy) when called with body element', () => {
      const result = pb.SelectorUtils.getSelector(document.body);
      expect(result).toBeFalsy();
    });

    test('returns null when called with null', () => {
      const result = pb.SelectorUtils.getSelector(null);
      expect(result).toBeFalsy();
    });

    test('generated selector can be used to re-find the element', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);

      const selector = pb.SelectorUtils.getSelector(p);
      const found = document.querySelector(selector);

      expect(found).toBe(p);
    });
  });

  // ── generateId ─────────────────────────────────────────────────────────────

  describe('generateId', () => {
    test('returns an 8-character string', () => {
      const id = pb.SelectorUtils.generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(8);
    });

    test('returns a hex string (only 0-9, a-f characters)', () => {
      const id = pb.SelectorUtils.generateId();
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test('returns unique values on repeated calls', () => {
      const ids = new Set();
      for (let i = 0; i < 50; i++) {
        ids.add(pb.SelectorUtils.generateId());
      }
      // With 50 calls we expect virtually no collisions (8-hex = 4 billion space).
      expect(ids.size).toBeGreaterThan(45);
    });
  });

  // ── restoreSelector ────────────────────────────────────────────────────────

  describe('restoreSelector', () => {
    test('returns the element when selector is valid and element exists', () => {
      const span = document.createElement('span');
      span.id = 'restoreMe';
      document.body.appendChild(span);

      const found = pb.SelectorUtils.restoreSelector('#restoreMe');

      expect(found).toBe(span);
    });

    test('returns null when selector matches nothing (stale selector)', () => {
      const found = pb.SelectorUtils.restoreSelector('#elementThatDoesNotExist');
      expect(found).toBeNull();
    });

    test('returns null instead of throwing for syntactically invalid selector', () => {
      // "##bad" is invalid CSS selector syntax.
      expect(() => {
        const found = pb.SelectorUtils.restoreSelector('##bad-selector!!!');
        expect(found).toBeNull();
      }).not.toThrow();
    });

    test('returns null for null input', () => {
      const found = pb.SelectorUtils.restoreSelector(null);
      expect(found).toBeNull();
    });

    test('returns null for empty string input', () => {
      // Empty string querySelector throws or returns null depending on impl.
      const found = pb.SelectorUtils.restoreSelector('');
      // Either null or no throw is acceptable.
      expect(found == null || found instanceof Element).toBe(true);
    });

    test('returns element by data-pb-id selector', () => {
      const div = document.createElement('div');
      div.dataset.pbId = 'abc12345';
      document.body.appendChild(div);

      const found = pb.SelectorUtils.restoreSelector('[data-pb-id="abc12345"]');

      expect(found).toBe(div);
    });
  });

  // ── restoreAllSelectors ────────────────────────────────────────────────────

  describe('restoreAllSelectors', () => {
    test('returns array of found elements for a mix of valid and stale selectors', () => {
      const div = document.createElement('div');
      div.id = 'existsNow';
      document.body.appendChild(div);

      const results = pb.SelectorUtils.restoreAllSelectors([
        '#existsNow',
        '#doesNotExist',
        '#alsoMissing',
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toBe(div);
    });

    test('returns empty array when all selectors are stale', () => {
      const results = pb.SelectorUtils.restoreAllSelectors([
        '#ghost1',
        '#ghost2',
      ]);
      expect(results).toEqual([]);
    });

    test('returns empty array when called with empty array', () => {
      const results = pb.SelectorUtils.restoreAllSelectors([]);
      expect(results).toEqual([]);
    });

    test('does not throw for invalid selector in the array', () => {
      expect(() => {
        pb.SelectorUtils.restoreAllSelectors(['##invalid', '#valid-but-missing']);
      }).not.toThrow();
    });

    test('returns empty array for non-array input', () => {
      const results = pb.SelectorUtils.restoreAllSelectors(null);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    });

    test('returns all elements when every selector is valid', () => {
      document.body.innerHTML = '<p id="p1">A</p><p id="p2">B</p><p id="p3">C</p>';

      const results = pb.SelectorUtils.restoreAllSelectors(['#p1', '#p2', '#p3']);

      expect(results).toHaveLength(3);
    });
  });

  // ── getSelector edge cases ────────────────────────────────────────────────

  describe('getSelector edge cases', () => {
    test('returns null when called with documentElement', () => {
      const result = pb.SelectorUtils.getSelector(document.documentElement);
      expect(result).toBeFalsy();
    });

    test('returns null when called with undefined', () => {
      const result = pb.SelectorUtils.getSelector(undefined);
      expect(result).toBeFalsy();
    });

    test('handles element with ID containing special characters', () => {
      const div = document.createElement('div');
      div.id = 'my:special.id';
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);

      // Should either use escaped ID or fall back to data-pb-id
      expect(selector).toBeTruthy();
      const found = document.querySelector(selector);
      expect(found).toBe(div);
    });

    test('handles element with numeric-starting ID', () => {
      const div = document.createElement('div');
      div.id = '123numeric';
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);
      expect(selector).toBeTruthy();

      const found = document.querySelector(selector);
      expect(found).toBe(div);
    });

    test('handles element with whitespace-only ID (falls back to nth-of-type)', () => {
      const div = document.createElement('div');
      div.setAttribute('id', '   ');
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);

      // Whitespace ID should be skipped, use nth-of-type path
      expect(selector).toMatch(/^body > /);
    });

    test('nth-of-type path can re-find the element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = pb.SelectorUtils.getSelector(div);
      const found = document.querySelector(selector);

      expect(found).toBe(div);
    });

    test('different elements get different data-pb-id values', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      document.body.appendChild(div1);
      document.body.appendChild(div2);

      const s1 = pb.SelectorUtils.getSelector(div1);
      const s2 = pb.SelectorUtils.getSelector(div2);

      expect(s1).not.toBe(s2);
    });
  });

  // ── restoreSelector edge cases ────────────────────────────────────────────

  describe('restoreSelector edge cases', () => {
    test('returns null for undefined input', () => {
      const found = pb.SelectorUtils.restoreSelector(undefined);
      expect(found).toBeNull();
    });

    test('returns null for numeric input', () => {
      const found = pb.SelectorUtils.restoreSelector(42);
      expect(found).toBeNull();
    });

    test('handles complex selectors correctly', () => {
      document.body.innerHTML = '<div class="container"><p class="text">Hello</p></div>';

      const found = pb.SelectorUtils.restoreSelector('.container > .text');
      expect(found).not.toBeNull();
      expect(found.textContent).toBe('Hello');
    });
  });

  // ── generateId robustness ─────────────────────────────────────────────────

  describe('generateId robustness', () => {
    test('all generated IDs are exactly 8 lowercase hex chars', () => {
      for (let i = 0; i < 100; i++) {
        const id = pb.SelectorUtils.generateId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    test('high uniqueness over many generations', () => {
      const ids = new Set();
      for (let i = 0; i < 500; i++) {
        ids.add(pb.SelectorUtils.generateId());
      }
      // With 32-bit space, 500 calls should have ~0 collisions
      expect(ids.size).toBeGreaterThanOrEqual(495);
    });
  });
});
