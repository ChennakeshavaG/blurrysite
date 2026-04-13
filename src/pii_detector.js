/**
 * pii_detector.js — Smart auto-detection of sensitive data (PII) on web pages.
 *
 * Scans text nodes for emails, phone numbers, SSNs, credit card numbers, and
 * financial figures. Wraps matches in blur spans that integrate with the
 * existing blur engine CSS rules.
 *
 * Exposed as blsi.PiiDetector (IIFE — no ES module syntax).
 */

const BlurrySitePiiDetector = (() => {
  'use strict';

  // ── PII regex patterns ─────────────────────────────────────────────────────
  // All patterns are non-backtracking (no nested quantifiers) for ReDoS safety.
  // Patterns use the 'g' flag for multi-match scanning per text node.

  const PATTERNS = Object.freeze({
    EMAIL: {
      regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
      label: 'email',
    },
    PHONE: {
      regex: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,5}[\s\-.]?\d{4}\b/g,
      label: 'phone',
    },
    SSN: {
      regex: /\b\d{3}[\-\s]\d{2}[\-\s]\d{4}\b/g,
      label: 'ssn',
    },
    CREDIT_CARD: {
      regex: /\b(?:\d[\s\-]?){12,18}\d\b/g,
      label: 'credit_card',
    },
    FINANCIAL: {
      regex: /[$\u20AC\u00A3\u00A5\u20B9]\s?\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{1,2})?\b/g,
      label: 'financial',
    },
  });

  const PII_ATTR = 'data-bl-si-pii';
  const BLUR_ATTR = 'data-bl-si-blur';

  let _observer = null;
  let _matchCount = 0;
  let _activeTypes = null;

  // ── Extension UI detection ─────────────────────────────────────────────────

  function _isExtensionUI(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    const toolbarId = blsi.IDS ? blsi.IDS.PICKER_TOOLBAR : 'bl-si-picker-toolbar';
    return (
      el.id === toolbarId ||
      el.closest('#' + toolbarId) !== null ||
      el.closest('.bl-si-toast') !== null ||
      el.closest('.bl-si-toolbar') !== null ||
      el.closest('[data-bl-si-zone]') !== null ||
      el.closest('#bl-si-svg-filters') !== null
    );
  }

  function _isInsidePiiSpan(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    return el.closest('[' + PII_ATTR + ']') !== null;
  }

  // ── Core scan logic ────────────────────────────────────────────────────────

  /**
   * Find all regex matches in a text string for enabled PII types.
   * Returns array of { start, end, type } sorted by start position.
   */
  function _findMatches(text, types) {
    const matches = [];
    for (const key of Object.keys(PATTERNS)) {
      if (!types[key]) continue;
      const pattern = PATTERNS[key];
      const re = new RegExp(pattern.regex.source, pattern.regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: pattern.label });
        if (m[0].length === 0) { re.lastIndex++; } // prevent infinite loop on zero-length match
      }
    }
    // Sort by start position, longest match first for overlaps
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    // Remove overlapping matches (keep first / longest)
    const filtered = [];
    let lastEnd = -1;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filtered.push(match);
        lastEnd = match.end;
      }
    }
    return filtered;
  }

  /**
   * Wrap matched portions of a text node in PII blur spans.
   * Processes matches RIGHT-TO-LEFT to preserve offsets.
   */
  function _wrapTextNode(textNode, matches) {
    if (matches.length === 0) return 0;
    const parent = textNode.parentNode;
    if (!parent) return 0;

    let count = 0;
    // Process right-to-left to preserve offsets
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end, type } = matches[i];
      const text = textNode.textContent;
      if (start >= text.length) continue;

      // Split: [before match] [match] [after match]
      const afterNode = textNode.splitText(end);
      const matchNode = textNode.splitText(start);
      // textNode now contains [before match], matchNode = [match text], afterNode = [after]

      const span = document.createElement('span');
      span.setAttribute(PII_ATTR, type);
      span.setAttribute(BLUR_ATTR, '1');
      span.textContent = matchNode.textContent;
      parent.replaceChild(span, matchNode);

      // Merge afterNode back if empty to keep DOM clean
      void afterNode;

      count++;
      _matchCount++;
    }
    return count;
  }

  /**
   * Scan a DOM subtree for PII in text nodes.
   * @param {Element} rootEl - Root element to scan
   * @param {Object} types - Which PII types to detect { EMAIL: true, PHONE: false, ... }
   * @returns {number} Number of matches found
   */
  function scan(rootEl, types) {
    if (!rootEl || !types) return 0;
    const enabledTypes = {};
    let anyEnabled = false;
    for (const key of Object.keys(PATTERNS)) {
      if (types[key]) { enabledTypes[key] = true; anyEnabled = true; }
    }
    if (!anyEnabled) return 0;

    _activeTypes = enabledTypes;
    let totalMatches = 0;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Process collected nodes (DOM changes during walk would break the walker)
    for (const tn of textNodes) {
      if (_isExtensionUI(tn)) continue;
      if (_isInsidePiiSpan(tn)) continue;
      const text = tn.textContent;
      if (!text || text.trim().length === 0) continue;

      const matches = _findMatches(text, enabledTypes);
      if (matches.length > 0) {
        totalMatches += _wrapTextNode(tn, matches);
      }
    }

    return totalMatches;
  }

  /**
   * Remove all PII blur spans, restoring original text nodes.
   * @param {Element} rootEl - Root element to clear
   */
  function clear(rootEl) {
    if (!rootEl) return;
    const piiSpans = rootEl.querySelectorAll('[' + PII_ATTR + ']');
    for (const span of piiSpans) {
      const parent = span.parentNode;
      if (!parent) continue;
      // Replace span with its text content
      const textNode = document.createTextNode(span.textContent);
      parent.replaceChild(textNode, span);
      // Normalize to merge adjacent text nodes
      parent.normalize();
    }
    _matchCount = 0;
  }

  /**
   * Start observing DOM for new nodes and scan them for PII.
   * @param {Element} rootEl - Root element to observe
   */
  function observeMutations(rootEl) {
    if (_observer) _observer.disconnect();
    if (!rootEl || !_activeTypes) return;

    _observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              if (!_isExtensionUI(node) && !_isInsidePiiSpan(node)) {
                const text = node.textContent;
                if (text && text.trim().length > 0) {
                  const matches = _findMatches(text, _activeTypes);
                  if (matches.length > 0) _wrapTextNode(node, matches);
                }
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              if (!_isExtensionUI(node) && !_isInsidePiiSpan(node)) {
                scan(node, _activeTypes);
              }
            }
          }
        }
      }
    });

    _observer.observe(rootEl, { childList: true, subtree: true });
  }

  /**
   * Stop observing DOM mutations.
   */
  function stopObserving() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
  }

  /**
   * Get the total number of PII matches found since last clear.
   */
  function getMatchCount() {
    return _matchCount;
  }

  /**
   * Get the pattern definitions (for testing).
   */
  function getPatterns() {
    return PATTERNS;
  }

  return Object.freeze({
    scan,
    clear,
    observeMutations,
    stopObserving,
    getMatchCount,
    getPatterns,
  });
})();

blsi.PiiDetector = BlurrySitePiiDetector;
