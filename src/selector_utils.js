/**
 * selector_utils.js — Blurry Site CSS Selector Utilities
 *
 * Generates stable, unique CSS selectors for DOM elements so that blur state
 * can be persisted and restored across page loads.
 *
 * Selector strategy — getSelectors() returns an array ordered structural → semantic.
 * Restore tries each in order; first unique match wins.
 *
 *  0. Full body-rooted nth-of-type path  — most precise, breaks on DOM insertions
 *  1. Nearest stable-ancestor-anchored path — shorter, more resilient
 *  2. Class combo (tag.c1.c2)           — stable if CSS classes are page-native
 *  3. [aria-label] + tag                — stable for designed ARIA attributes
 *  4. Stable data-* attributes          — stable for test/framework attrs
 *  5. Unique #id                        — most stable (last in the array)
 *
 * Exposed as blsi.SelectorUtils (IIFE — no ES module syntax).
 */

const SelectorUtils = (() => {
  'use strict';

  // Stable data-* attributes checked for strategy 4 (in order).
  var STABLE_DATA_ATTRS = ['data-testid', 'data-cy', 'data-id', 'data-name', 'data-key', 'data-component', 'name'];

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/([^\w-])/g, '\\$1');
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_e) {
      return false;
    }
  }

  // ── Strategy 0: full body-rooted nth-of-type path ─────────────────────────
  function buildNthChildPath(element) {
    var parts = [];
    var node = element;
    while (node && node !== document.body && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) break;
      var idx = 1;
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i] === node) break;
        if (parent.children[i].tagName === node.tagName) idx++;
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = parent;
    }
    if (parts.length === 0) return null;
    return 'body > ' + parts.join(' > ');
  }

  // ── Strategy 1: anchored path (walk up to nearest stable ancestor) ─────────
  // Produces '#ancestor-id > tag:nth-of-type(n) > tag:nth-of-type(m)'
  // which is shorter and more resilient than the full body path.
  function buildAnchoredPath(element) {
    var parts = [];
    var node = element;
    while (node && node !== document.body && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) break;

      // Stop if PARENT has a stable anchor (id or stable data-*)
      var parentId = parent === document.body ? null : parent.getAttribute('id');
      var hasParentAnchor = parentId && parentId.trim().length > 0;
      if (!hasParentAnchor) {
        for (var d = 0; d < STABLE_DATA_ATTRS.length; d++) {
          var dval = parent.getAttribute(STABLE_DATA_ATTRS[d]);
          if (dval && dval.trim().length > 0) { hasParentAnchor = true; break; }
        }
      }

      var idx = 1;
      for (var j = 0; j < parent.children.length; j++) {
        if (parent.children[j] === node) break;
        if (parent.children[j].tagName === node.tagName) idx++;
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = parent;

      if (hasParentAnchor) {
        // Build the anchor prefix
        var anchorAttr = null;
        if (parentId && parentId.trim().length > 0) {
          anchorAttr = '#' + cssEscape(parentId.trim());
        } else {
          for (var k = 0; k < STABLE_DATA_ATTRS.length; k++) {
            var av = parent.getAttribute(STABLE_DATA_ATTRS[k]);
            if (av && av.trim().length > 0) {
              anchorAttr = '[' + STABLE_DATA_ATTRS[k] + '=' + JSON.stringify(av.trim()) + ']';
              break;
            }
          }
        }
        if (!anchorAttr) break;
        var candidate = anchorAttr + ' > ' + parts.join(' > ');
        // Only emit if anchor itself is unique and the full path is unique
        if (!isUnique(anchorAttr)) break;
        return isUnique(candidate) ? candidate : null;
      }
    }
    return null;
  }

  // ── Strategy 2: class combo ───────────────────────────────────────────────
  function buildClassSelector(element) {
    if (!element.className || typeof element.className !== 'string') return null;
    var tag = element.tagName.toLowerCase();
    var classes = element.className.trim().split(/\s+/).filter(function(c) {
      return c && !c.startsWith('bl-si-');
    });
    if (classes.length === 0) return null;

    var classSelector = tag + '.' + classes.map(cssEscape).join('.');

    // Prefer parent-id scoped selector when unique (more specific).
    var parent = element.parentElement;
    if (parent && parent.id) {
      var contextSelector = '#' + cssEscape(parent.id) + ' > ' + classSelector;
      if (isUnique(contextSelector)) return contextSelector;
    }

    // Always include class combo even when non-unique — useful for intersection-
    // based highlight fallback: querySelectorAll(combo) ∩ [data-bl-si-pick-blur].
    return classSelector;
  }

  // ── Strategy 3: aria-label + tag ─────────────────────────────────────────
  function buildAriaSelector(element) {
    var label = element.getAttribute('aria-label');
    if (!label || label.trim().length === 0 || label.length > 80) return null;
    var tag = element.tagName.toLowerCase();
    var candidate = tag + '[aria-label=' + JSON.stringify(label.trim()) + ']';
    return isUnique(candidate) ? candidate : null;
  }

  // ── Strategy 4: stable data-* attributes ─────────────────────────────────
  function buildDataAttrSelector(element) {
    for (var i = 0; i < STABLE_DATA_ATTRS.length; i++) {
      var val = element.getAttribute(STABLE_DATA_ATTRS[i]);
      if (!val || val.trim().length === 0) continue;
      var candidate = '[' + STABLE_DATA_ATTRS[i] + '=' + JSON.stringify(val.trim()) + ']';
      if (isUnique(candidate)) return candidate;
      // Also try scoped with tag
      var tagged = element.tagName.toLowerCase() + candidate;
      if (isUnique(tagged)) return tagged;
    }
    return null;
  }

  // ── Strategy 5: unique #id ────────────────────────────────────────────────
  function buildIdSelector(element) {
    var id = element.getAttribute('id');
    if (!id || id.trim().length === 0) return null;
    var candidate = '#' + cssEscape(id.trim());
    return isUnique(candidate) ? candidate : null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Returns an ordered array of CSS selectors for the element.
   * Index 0 is most structural (precise, fragile); last index is most semantic (stable).
   * Restore tries each in order — first unique match wins.
   * Only selectors confirmed unique via querySelectorAll are included.
   */
  function getSelectors(element) {
    if (!element || !(element instanceof Element)) return [];
    if (element === document.body || element === document.documentElement) return [];

    var results = [];
    var seen = new Set();

    function push(sel) {
      if (sel && !seen.has(sel)) { seen.add(sel); results.push(sel); }
    }

    push(buildNthChildPath(element));   // 0: full structural
    push(buildAnchoredPath(element));   // 1: anchored structural
    push(buildClassSelector(element));  // 2: class combo
    push(buildAriaSelector(element));   // 3: aria-label
    push(buildDataAttrSelector(element)); // 4: data-* attrs
    push(buildIdSelector(element));     // 5: #id

    return results;
  }

  /**
   * Returns the first (most structural) unique selector for an element, or null.
   * Backward-compat alias for getSelectors()[0].
   */
  function getSelector(element) {
    var s = getSelectors(element);
    return s.length > 0 ? s[0] : null;
  }

  /**
   * Fast O(1) heuristic: does this element have any stable semantic signal?
   * Returns true if the element has an id, aria-label, non-bl-si classes, or
   * a recognised stable data-* attribute. Used by picker.js to show the
   * "may not persist on reload" warning without running full querySelectorAll.
   */
  function isSelectorStable(element) {
    if (!element || !(element instanceof Element)) return false;
    if (element.getAttribute('id')) return true;
    if (element.getAttribute('aria-label')) return true;
    var classes = (element.className || '').split(/\s+/).filter(function(c) {
      return c && !c.startsWith('bl-si-');
    });
    if (classes.length > 0) return true;
    for (var i = 0; i < STABLE_DATA_ATTRS.length; i++) {
      if (element.getAttribute(STABLE_DATA_ATTRS[i])) return true;
    }
    return false;
  }

  /**
   * Generates a short 8-character hex UUID.
   */
  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      var arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0].toString(16).padStart(8, '0');
    }
    return Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
  }

  /**
   * Finds a DOM element from a stored selector or array of selectors.
   * Tries each in order; returns the first element that uniquely matches (length === 1).
   * Returns null if no selector matches.
   */
  function restoreSelector(selectorOrArray) {
    if (!selectorOrArray) return null;
    var list = Array.isArray(selectorOrArray) ? selectorOrArray : [selectorOrArray];
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel || typeof sel !== 'string') continue;
      try {
        var matches = document.querySelectorAll(sel);
        if (matches.length === 1) return matches[0];
      } catch (_e) {
        // Invalid or stale selector — try next
      }
    }
    return null;
  }

  /**
   * Resolves an array of stored selectors back to DOM elements.
   * Each entry can be a string (legacy) or string[] (new multi-strategy).
   * Entries that no longer match are silently skipped.
   */
  function restoreAllSelectors(selectors) {
    if (!Array.isArray(selectors)) return [];
    return selectors.map(function(s) { return restoreSelector(s); }).filter(function(el) { return el !== null; });
  }

  return {
    getSelectors,
    getSelector,
    isSelectorStable,
    generateId,
    restoreSelector,
    restoreAllSelectors,
  };
})();

blsi.SelectorUtils = SelectorUtils;
