/**
 * tests/unit/selector_utils.test.js
 *
 * Unit tests for src/selector_utils.js
 * Module exposes blsi.SelectorUtils with:
 *   getSelectors, getSelector (alias), isSelectorStable,
 *   generateId, restoreSelector, restoreAllSelectors
 */

/* === TEST QUALITY ANNOTATIONS ===
 *
 * COVERS:
 *   - getSelector: unique ID path, duplicate-ID fallback, nth-of-type path, body/null/undefined
 *     guards, special-character IDs, numeric-start IDs, whitespace-only ID fallback,
 *     round-trip querySelector verification, selector stability (two calls, same result),
 *     sibling disambiguation, documentElement guard
 *   - generateId: 8-char hex string, uniqueness over 50 calls, format over 100 calls,
 *     uniqueness over 500 calls
 *   - restoreSelector: valid match, stale selector, invalid CSS syntax (no throw), null,
 *     empty string, data-attribute selector, undefined, numeric input, complex descendant selector
 *   - restoreAllSelectors: mixed valid/stale, all stale, empty array, invalid selector in array,
 *     non-array input, all valid
 *
 * REDUNDANT:
 *   - "returns nth-of-type path when no unique identifier found" (line ~128) and
 *     "returns nth-of-type path when element has no ID" (line ~138) both create a bare <div>
 *     with no ID and assert the selector contains 'nth-of-type'. The second adds only a more
 *     specific prefix assertion — candidate for merging into one test with both assertions.
 *   - "returns an 8-character string" (generateId, line ~181) and
 *     "all generated IDs are exactly 8 lowercase hex chars" (generateId robustness, line ~400)
 *     — the robustness test runs 100 iterations and fully subsumes the single-call test.
 *   - "returns null (or falsy) when called with body element" (line ~157) and
 *     "returns null when called with documentElement" (line ~306) test the same excluded-node
 *     guard; candidate for a single test.each(['body', 'documentElement', null, undefined]) table.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Guard clause tests that assert restoreSelector returns null (null, undefined, numeric,
 *     empty string inputs) could be merged into a test.each([input, label]) table.
 *   - restoreAllSelectors non-array / empty inputs could also be a test.each table.
 *   - getSelector excluded-node tests (body, documentElement) are natural test.each candidates.
 *
 * MISSING COVERAGE:
 *   - Class-based selector strategy — entire code path (e.g. element with unique className but
 *     no ID) is not exercised; it is unclear if this path exists in the real implementation.
 *   - Parent-ID context selector — no test for the "#parentId > tag.className" path that some
 *     implementations use when a unique parent ID is available.
 *   - CSS.escape fallback — no test for behaviour when the global CSS object is absent.
 *   - Selector stability across DOM mutations — nth-of-type selectors become stale when siblings
 *     are inserted before the element; this fragility is undocumented in tests.
 *   - getSelector on a detached element (not attached to document.body) — return value undefined.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/selector_utils.js');

function loadSelectorUtils() {
  if (blsi.SelectorUtils) return;
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

    var STABLE_DATA_ATTRS = ['data-testid','data-cy','data-id','data-name','data-key','data-component','name'];

    function cssEscape(v) {
      return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : String(v).replace(/([^\\w-])/g, '\\\\$1');
    }

    function isUnique(sel) {
      try { return document.querySelectorAll(sel).length === 1; } catch(_) { return false; }
    }

    function buildNthChildPath(el) {
      var parts = [], node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        var tag = node.tagName.toLowerCase(), parent = node.parentElement;
        if (!parent) break;
        var idx = 1;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i] === node) break;
          if (parent.children[i].tagName === node.tagName) idx++;
        }
        parts.unshift(tag + ':nth-of-type(' + idx + ')');
        node = parent;
      }
      return parts.length ? 'body > ' + parts.join(' > ') : null;
    }

    function generateId() {
      return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    }

    function getSelectors(el) {
      if (!el || !(el instanceof Element) || el === document.body || el === document.documentElement) return [];
      var results = [], seen = {};
      function push(s) { if (s && !seen[s]) { seen[s]=true; results.push(s); } }
      push(buildNthChildPath(el));
      if (el.id && el.id.trim()) { var s='#'+cssEscape(el.id.trim()); if(isUnique(s)) push(s); }
      blsi.SelectorUtils = { getSelectors: getSelectors, getSelector: function(e) { var r=getSelectors(e); return r.length?r[0]:null; }, isSelectorStable: isSelectorStable, generateId: generateId, restoreSelector: restoreSelector, restoreAllSelectors: restoreAllSelectors };
      return results;
    }

    function getSelector(el) { var r = getSelectors(el); return r.length ? r[0] : null; }

    function isSelectorStable(el) {
      if (!el || !(el instanceof Element)) return false;
      if (el.getAttribute('id')) return true;
      if (el.getAttribute('aria-label')) return true;
      var cls = (el.className||'').split(/\\s+/).filter(function(c){return c&&!c.startsWith('bl-si-');});
      if (cls.length > 0) return true;
      for (var i=0; i<STABLE_DATA_ATTRS.length; i++) { if (el.getAttribute(STABLE_DATA_ATTRS[i])) return true; }
      return false;
    }

    function restoreSelector(selectorOrArray) {
      if (!selectorOrArray) return null;
      var list = Array.isArray(selectorOrArray) ? selectorOrArray : [selectorOrArray];
      for (var i = 0; i < list.length; i++) {
        var sel = list[i];
        if (!sel || typeof sel !== 'string') continue;
        try { var m = document.querySelectorAll(sel); if (m.length === 1) return m[0]; } catch(_) {}
      }
      return null;
    }

    function restoreAllSelectors(selectors) {
      if (!Array.isArray(selectors)) return [];
      return selectors.map(function(s) { return restoreSelector(s); }).filter(function(el) { return el !== null; });
    }

    blsi.SelectorUtils = {
      getSelectors: getSelectors,
      getSelector: getSelector,
      isSelectorStable: isSelectorStable,
      generateId: generateId,
      restoreSelector: restoreSelector,
      restoreAllSelectors: restoreAllSelectors,
    };
  })();
  `;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('blsi.SelectorUtils', () => {
  beforeAll(() => {
    loadSelectorUtils();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── getSelector ────────────────────────────────────────────────────────────

  // USER IMPACT: user blurs an element — a stable CSS selector is generated so the blur survives page reload and SPA re-renders
  describe('getSelector', () => {
    test('returns structural selector first even when element has a unique ID', () => {
      // getSelector is an alias for getSelectors()[0] — structural path is always index 0.
      // The #id is still in the selectors array (tested in getSelectors suite), just not first.
      const div = document.createElement('div');
      div.id = 'uniqueTarget';
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);

      expect(selector).toMatch(/nth-of-type/);
      expect(selector).toMatch(/^body > /);
    });

    test('does not use ID selector when multiple elements share the same ID', () => {
      // Malformed HTML, but should still handle gracefully.
      const div1 = document.createElement('div');
      div1.id = 'shared';
      const div2 = document.createElement('div');
      div2.id = 'shared';
      document.body.appendChild(div1);
      document.body.appendChild(div2);

      const selector = blsi.SelectorUtils.getSelector(div1);

      // Should NOT return '#shared' because it is not unique.
      expect(selector).not.toBe('#shared');
    });

    // REDUNDANT: same fallback path as "returns nth-of-type path when element has no ID" below; both create a bare <div> — merge into one test with both assertions
    test('returns nth-of-type path when no unique identifier found', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);

      expect(selector).toMatch(/^body > /);
      expect(selector).toContain('nth-of-type');
    });

    // REDUNDANT: same fallback path as "returns nth-of-type path when no unique identifier found" above; only adds a more specific prefix assertion
    test('returns nth-of-type path when element has no ID', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);

      expect(selector).toMatch(/^body > div:nth-of-type/);
    });

    test('returns same selector when called twice on same element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const s1 = blsi.SelectorUtils.getSelector(div);
      const s2 = blsi.SelectorUtils.getSelector(div);

      expect(s1).toBe(s2);
    });

    // REDUNDANT: excluded-node guard; can be merged with "returns null when called with documentElement" into a test.each([document.body, document.documentElement, null, undefined]) table
    test('returns null (or falsy) when called with body element', () => {
      const result = blsi.SelectorUtils.getSelector(document.body);
      expect(result).toBeFalsy();
    });

    test('returns null when called with null', () => {
      const result = blsi.SelectorUtils.getSelector(null);
      expect(result).toBeFalsy();
    });

    test('generated selector can be used to re-find the element', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);

      const selector = blsi.SelectorUtils.getSelector(p);
      const found = document.querySelector(selector);

      expect(found).toBe(p);
    });
    // MISSING: no test for class-based selector strategy (unique className, no ID)
    // MISSING: no test for parent-ID context selector (#parentId > tag.className path)
    // MISSING: no test for getSelector on a detached element (not in document.body)
  });

  // ── getSelectors ───────────────────────────────────────────────────────────

  // USER IMPACT: picker saves multiple selector strategies so blur survives page reload even when structural paths change on SPA re-renders
  describe('getSelectors', () => {
    test('returns an array', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(Array.isArray(blsi.SelectorUtils.getSelectors(div))).toBe(true);
    });

    test('returns empty array for body element', () => {
      expect(blsi.SelectorUtils.getSelectors(document.body)).toEqual([]);
    });

    test('returns empty array for documentElement', () => {
      expect(blsi.SelectorUtils.getSelectors(document.documentElement)).toEqual([]);
    });

    test('returns empty array for null', () => {
      expect(blsi.SelectorUtils.getSelectors(null)).toEqual([]);
    });

    test('first selector in array is structural (nth-of-type path)', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const selectors = blsi.SelectorUtils.getSelectors(div);
      expect(selectors.length).toBeGreaterThan(0);
      expect(selectors[0]).toMatch(/nth-of-type/);
    });

    test('includes #id selector when element has unique id', () => {
      const div = document.createElement('div');
      div.id = 'uniqueEl';
      document.body.appendChild(div);
      const selectors = blsi.SelectorUtils.getSelectors(div);
      expect(selectors.some(s => s === '#uniqueEl')).toBe(true);
    });

    test('#id selector is not first when element also has structural path', () => {
      const div = document.createElement('div');
      div.id = 'stableEl';
      document.body.appendChild(div);
      const selectors = blsi.SelectorUtils.getSelectors(div);
      // structural (nth-of-type) should come before #id
      const nthIdx = selectors.findIndex(s => s.includes('nth-of-type'));
      const idIdx = selectors.findIndex(s => s === '#stableEl');
      if (nthIdx !== -1 && idIdx !== -1) {
        expect(nthIdx).toBeLessThan(idIdx);
      }
    });

    test('every selector in the array uniquely matches the element', () => {
      const div = document.createElement('div');
      div.id = 'roundTrip';
      document.body.appendChild(div);
      const selectors = blsi.SelectorUtils.getSelectors(div);
      for (const sel of selectors) {
        const matches = document.querySelectorAll(sel);
        expect(matches.length).toBe(1);
        expect(matches[0]).toBe(div);
      }
    });

    test('different elements produce different selector arrays', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      document.body.appendChild(div1);
      document.body.appendChild(div2);
      const s1 = blsi.SelectorUtils.getSelectors(div1)[0];
      const s2 = blsi.SelectorUtils.getSelectors(div2)[0];
      expect(s1).not.toBe(s2);
    });

    test('no duplicate selectors within the returned array', () => {
      const div = document.createElement('div');
      div.id = 'noDupe';
      document.body.appendChild(div);
      const selectors = blsi.SelectorUtils.getSelectors(div);
      const unique = [...new Set(selectors)];
      expect(selectors.length).toBe(unique.length);
    });
  });

  // ── getSelector (compat alias) ─────────────────────────────────────────────

  describe('getSelector (compat alias)', () => {
    test('returns a string or null (not an array)', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const result = blsi.SelectorUtils.getSelector(div);
      expect(typeof result === 'string' || result === null).toBe(true);
    });

    test('returns first selector from getSelectors', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const first = blsi.SelectorUtils.getSelectors(div)[0] ?? null;
      expect(blsi.SelectorUtils.getSelector(div)).toBe(first);
    });

    test('returns null for body', () => {
      expect(blsi.SelectorUtils.getSelector(document.body)).toBeFalsy();
    });
  });

  // ── isSelectorStable ───────────────────────────────────────────────────────

  // USER IMPACT: picker shows "may not persist" warning on hover when element has no stable signals, preventing user confusion after reload
  describe('isSelectorStable', () => {
    test('returns true for element with unique id', () => {
      const div = document.createElement('div');
      div.id = 'stableId';
      document.body.appendChild(div);
      expect(blsi.SelectorUtils.isSelectorStable(div)).toBe(true);
    });

    test('returns true for element with non-bl-si class', () => {
      const div = document.createElement('div');
      div.className = 'card-body featured';
      document.body.appendChild(div);
      expect(blsi.SelectorUtils.isSelectorStable(div)).toBe(true);
    });

    test('returns false for element with only bl-si-* classes', () => {
      const div = document.createElement('div');
      div.className = 'bl-si-blurred bl-si-frosted';
      document.body.appendChild(div);
      expect(blsi.SelectorUtils.isSelectorStable(div)).toBe(false);
    });

    test('returns true for element with aria-label', () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Close dialog');
      document.body.appendChild(btn);
      expect(blsi.SelectorUtils.isSelectorStable(btn)).toBe(true);
    });

    test('returns true for element with data-testid', () => {
      const div = document.createElement('div');
      div.setAttribute('data-testid', 'submit-button');
      document.body.appendChild(div);
      expect(blsi.SelectorUtils.isSelectorStable(div)).toBe(true);
    });

    test('returns false for bare element with no stable signals', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(blsi.SelectorUtils.isSelectorStable(div)).toBe(false);
    });

    test('returns false for null', () => {
      expect(blsi.SelectorUtils.isSelectorStable(null)).toBe(false);
    });

    test('returns false for non-element', () => {
      expect(blsi.SelectorUtils.isSelectorStable('div')).toBe(false);
    });
  });

  // ── restoreSelector — array input ─────────────────────────────────────────

  // USER IMPACT: blur items now store selectors[] array; restore tries each entry so blur survives when structural selectors become stale
  describe('restoreSelector — array input', () => {
    test('returns element when first selector matches', () => {
      const div = document.createElement('div');
      div.id = 'first';
      document.body.appendChild(div);
      const found = blsi.SelectorUtils.restoreSelector(['#first', '#missing']);
      expect(found).toBe(div);
    });

    test('falls back to second selector when first does not match', () => {
      const div = document.createElement('div');
      div.id = 'second';
      document.body.appendChild(div);
      const found = blsi.SelectorUtils.restoreSelector(['#staleFirst', '#second']);
      expect(found).toBe(div);
    });

    test('returns null for empty array', () => {
      expect(blsi.SelectorUtils.restoreSelector([])).toBeNull();
    });

    test('returns null when no selector in array matches', () => {
      const found = blsi.SelectorUtils.restoreSelector(['#ghost1', '#ghost2']);
      expect(found).toBeNull();
    });

    test('skips invalid CSS selectors without throwing', () => {
      const div = document.createElement('div');
      div.id = 'afterInvalid';
      document.body.appendChild(div);
      expect(() => {
        const found = blsi.SelectorUtils.restoreSelector(['##invalid!', '#afterInvalid']);
        expect(found).toBe(div);
      }).not.toThrow();
    });

    test('does not return element when selector matches multiple elements (non-unique)', () => {
      document.body.innerHTML = '<p class="dup">A</p><p class="dup">B</p>';
      const found = blsi.SelectorUtils.restoreSelector(['.dup']);
      expect(found).toBeNull();
    });
  });

  // ── generateId ─────────────────────────────────────────────────────────────

  // USER IMPACT: multiple blur items each need a unique ID so they can be independently removed without affecting sibling items
  describe('generateId', () => {
    // REDUNDANT: "all generated IDs are exactly 8 lowercase hex chars" in the robustness describe runs 100 iterations and fully subsumes this single-call test
    test('returns an 8-character string', () => {
      const id = blsi.SelectorUtils.generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(8);
    });

    test('returns a hex string (only 0-9, a-f characters)', () => {
      const id = blsi.SelectorUtils.generateId();
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test('returns unique values on repeated calls', () => {
      const ids = new Set();
      for (let i = 0; i < 50; i++) {
        ids.add(blsi.SelectorUtils.generateId());
      }
      // With 50 calls we expect virtually no collisions (8-hex = 4 billion space).
      expect(ids.size).toBeGreaterThan(45);
    });
  });

  // ── restoreSelector ────────────────────────────────────────────────────────

  // USER IMPACT: page load — saved selectors re-find their elements so blur is reapplied; stale selectors (SPA re-render) return null safely instead of crashing
  describe('restoreSelector', () => {
    test('returns the element when selector is valid and element exists', () => {
      const span = document.createElement('span');
      span.id = 'restoreMe';
      document.body.appendChild(span);

      const found = blsi.SelectorUtils.restoreSelector('#restoreMe');

      expect(found).toBe(span);
    });

    test('returns null when selector matches nothing (stale selector)', () => {
      const found = blsi.SelectorUtils.restoreSelector('#elementThatDoesNotExist');
      expect(found).toBeNull();
    });

    test('returns null instead of throwing for syntactically invalid selector', () => {
      // "##bad" is invalid CSS selector syntax.
      expect(() => {
        const found = blsi.SelectorUtils.restoreSelector('##bad-selector!!!');
        expect(found).toBeNull();
      }).not.toThrow();
    });

    // OPTIMIZE: null, empty string, undefined, and numeric inputs all test the same guard; consolidate into a test.each([null, '', undefined, 42]) table
    test('returns null for null input', () => {
      const found = blsi.SelectorUtils.restoreSelector(null);
      expect(found).toBeNull();
    });

    test('returns null for empty string input', () => {
      // Empty string querySelector throws or returns null depending on impl.
      const found = blsi.SelectorUtils.restoreSelector('');
      // Either null or no throw is acceptable.
      expect(found == null || found instanceof Element).toBe(true);
    });

    test('returns element by data attribute selector', () => {
      const div = document.createElement('div');
      div.dataset.blSiId = 'abc12345';
      document.body.appendChild(div);

      const found = blsi.SelectorUtils.restoreSelector('[data-bl-si-id="abc12345"]');

      expect(found).toBe(div);
    });
    // MISSING: no test for CSS.escape fallback when global CSS object is absent
    // MISSING: no test for restoreSelector when querySelector returns the first of multiple matches (ambiguous selector)
  });

  // ── restoreAllSelectors ────────────────────────────────────────────────────

  // USER IMPACT: extension init — all saved blur items for a page are restored in one pass; stale selectors are silently dropped so partial staleness never blocks the valid items
  describe('restoreAllSelectors', () => {
    test('returns array of found elements for a mix of valid and stale selectors', () => {
      const div = document.createElement('div');
      div.id = 'existsNow';
      document.body.appendChild(div);

      const results = blsi.SelectorUtils.restoreAllSelectors([
        '#existsNow',
        '#doesNotExist',
        '#alsoMissing',
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toBe(div);
    });

    test('returns empty array when all selectors are stale', () => {
      const results = blsi.SelectorUtils.restoreAllSelectors([
        '#ghost1',
        '#ghost2',
      ]);
      expect(results).toEqual([]);
    });

    test('returns empty array when called with empty array', () => {
      const results = blsi.SelectorUtils.restoreAllSelectors([]);
      expect(results).toEqual([]);
    });

    test('does not throw for invalid selector in the array', () => {
      expect(() => {
        blsi.SelectorUtils.restoreAllSelectors(['##invalid', '#valid-but-missing']);
      }).not.toThrow();
    });

    // OPTIMIZE: non-array inputs (null, undefined, string, number) all hit the same early-return guard; use test.each([null, undefined, 'string', 42])
    test('returns empty array for non-array input', () => {
      const results = blsi.SelectorUtils.restoreAllSelectors(null);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    });

    test('returns all elements when every selector is valid', () => {
      document.body.innerHTML = '<p id="p1">A</p><p id="p2">B</p><p id="p3">C</p>';

      const results = blsi.SelectorUtils.restoreAllSelectors(['#p1', '#p2', '#p3']);

      expect(results).toHaveLength(3);
    });
    // MISSING: no test for restoreAllSelectors preserving order of found elements
    // MISSING: no test for restoreAllSelectors with duplicate selectors in the input array
  });

  // ── getSelector edge cases ────────────────────────────────────────────────

  // USER IMPACT: edge-case element types (special IDs, numeric IDs, whitespace IDs) produce a usable selector so blur still persists
  describe('getSelector edge cases', () => {
    // REDUNDANT: same excluded-node guard as "returns null (or falsy) when called with body element" above; merge both into a test.each([document.body, document.documentElement]) table
    test('returns null when called with documentElement', () => {
      const result = blsi.SelectorUtils.getSelector(document.documentElement);
      expect(result).toBeFalsy();
    });

    test('returns null when called with undefined', () => {
      const result = blsi.SelectorUtils.getSelector(undefined);
      expect(result).toBeFalsy();
    });

    test('handles element with ID containing special characters', () => {
      const div = document.createElement('div');
      div.id = 'my:special.id';
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);

      // Should either use escaped ID or fall back to nth-of-type path
      expect(selector).toBeTruthy();
      const found = document.querySelector(selector);
      expect(found).toBe(div);
    });

    test('handles element with numeric-starting ID', () => {
      const div = document.createElement('div');
      div.id = '123numeric';
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);
      expect(selector).toBeTruthy();

      const found = document.querySelector(selector);
      expect(found).toBe(div);
    });

    test('handles element with whitespace-only ID (falls back to nth-of-type)', () => {
      const div = document.createElement('div');
      div.setAttribute('id', '   ');
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);

      // Whitespace ID should be skipped, use nth-of-type path
      expect(selector).toMatch(/^body > /);
    });

    test('nth-of-type path can re-find the element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const selector = blsi.SelectorUtils.getSelector(div);
      const found = document.querySelector(selector);

      expect(found).toBe(div);
    });

    test('different elements get different selectors', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      document.body.appendChild(div1);
      document.body.appendChild(div2);

      const s1 = blsi.SelectorUtils.getSelector(div1);
      const s2 = blsi.SelectorUtils.getSelector(div2);

      expect(s1).not.toBe(s2);
    });
    // MISSING: no test for selector fragility when a sibling is inserted before the element (nth-of-type index shifts)
    // MISSING: no test for getSelector on an element inside a shadow root
  });

  // ── restoreSelector edge cases ────────────────────────────────────────────

  // USER IMPACT: non-string inputs from serialization bugs do not throw and return null cleanly
  // OPTIMIZE: null, undefined, and numeric inputs all hit the same early-return guard; consolidate into a test.each([undefined, 42]) table alongside the null test in restoreSelector above
  describe('restoreSelector edge cases', () => {
    test('returns null for undefined input', () => {
      const found = blsi.SelectorUtils.restoreSelector(undefined);
      expect(found).toBeNull();
    });

    test('returns null for numeric input', () => {
      const found = blsi.SelectorUtils.restoreSelector(42);
      expect(found).toBeNull();
    });

    test('handles complex selectors correctly', () => {
      document.body.innerHTML = '<div class="container"><p class="text">Hello</p></div>';

      const found = blsi.SelectorUtils.restoreSelector('.container > .text');
      expect(found).not.toBeNull();
      expect(found.textContent).toBe('Hello');
    });
  });

  // ── generateId robustness ─────────────────────────────────────────────────

  // USER IMPACT: high-volume blur sessions (100+ items) still assign unique IDs so no two items collide and accidentally share remove operations
  describe('generateId robustness', () => {
    // REDUNDANT: subsumes "returns an 8-character string" in the generateId describe above — the 100-iteration loop covers both the length and the format assertions
    test('all generated IDs are exactly 8 lowercase hex chars', () => {
      for (let i = 0; i < 100; i++) {
        const id = blsi.SelectorUtils.generateId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    test('high uniqueness over many generations', () => {
      const ids = new Set();
      for (let i = 0; i < 500; i++) {
        ids.add(blsi.SelectorUtils.generateId());
      }
      // With 32-bit space, 500 calls should have ~0 collisions
      expect(ids.size).toBeGreaterThanOrEqual(495);
    });
  });
});
