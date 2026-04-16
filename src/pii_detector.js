/**
 * pii_detector.js — Automatic PII detection on web pages.
 *
 * Scans text nodes using two patterns:
 *   EMAIL   — standard email addresses (contains @)
 *   NUMERIC — currency amounts, 4+ digit numbers, currency-code suffixes
 *
 * PII spans carry [data-bl-si-pii] only — no [data-bl-si-blur]. Blur is driven
 * by the [data-bl-si-pii]:not([data-bl-si-reveal]) rule in content.css, fully
 * independent of blur-all state. Enabling PII detection always blurs matching
 * text regardless of whether blur-all is on or off.
 *
 * Exposed as blsi.PiiDetector (IIFE — no ES module syntax).
 */

const BlurrySitePiiDetector = (() => {
  'use strict';

  // ── PII patterns ───────────────────────────────────────────────────────────
  // All patterns use the /g flag; _findMatches clones via new RegExp(re.source, re.flags)
  // to reset lastIndex before each call, so patterns are safe to share.

  // EMAIL: standard RFC-ish local@domain.tld
  // Pre-filter: only run on text containing '@' to avoid O(n) regex on every node.
  const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  // NUMERIC: five sub-patterns, order matters — first match at a given position wins.
  //   1. Currency symbol prefix  — $1,234.56  €500  ₹50,000
  //      Trailing decimal/K-suffix dropped: [\d,.'\u00A0]* already captures them.
  //   2. Currency code suffix    — 1234 USD   50000 EUR
  //   3. Comma-grouped thousands — 1,234,567  12,345  (US/UK format, no symbol)
  //   4. Space/hyphen digit groups (phone-like) — 111-222-333  111 2222 333
  //      MUST come before sub-5 so "4111 1111 1111 1111" wraps as ONE span.
  //      Requires ≥3 groups of ≥2 digits each, separated by [ \-\u00A0] only
  //      (no newline/tab — phone numbers don't span lines).
  //   5. 4+ bare digit sequence  — 17150  account numbers  (catch-all)
  //
  // Intentionally broad: users opt-in knowing years (2024), IDs may fire.
  const NUMERIC_RE = /[$\u20AC\u00A3\u00A5\u20B9\u20A9\u20BF\u20BA\u20A8\u20B1\u0E3F]\s*\d[\d,.'\u00A0]*|\b\d[\d,.'\u00A0]*\s*(?:USD|EUR|GBP|JPY|INR|BTC|ETH)\b|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d{2,}(?:[ \-\u00A0]\d{2,}){2,}\b|\b\d{4,}\b/g;

  const PATTERNS = Object.freeze({
    EMAIL:   { regex: EMAIL_RE,   label: 'email' },
    NUMERIC: { regex: NUMERIC_RE, label: 'numeric' },
  });

  const PII_ATTR = 'data-bl-si-pii';

  // ── Conservative mode — label-context filter ───────────────────────────────
  // Only used when types.NUMERIC === 'conservative'. Checks the 100-char text
  // window around the match for Tier A sensitive labels (positive signal) and
  // price suppressors (negative signal — indicates public pricing, not PII).
  // Decision: suppressor present → skip; Tier A label → hide; neither → skip.

  const SENSITIVE_LABELS = /balance|salary|wages|account|invoice|subtotal|total due|amount due|net pay|credit card|card number|ssn|social security|passport|sort code|routing|iban|swift/i;
  const PRICE_SUPPRESSORS = /\/mo(?:nth)?|\/yr(?:ear)?|per month|per year|\bcart\b|\bqty\b|\bquantity\b|\bunits\b|\bcount\b|\brating\b|\breviews?\b|\bstars?\b/i;

  function _hasContextLabel(text, matchIndex) {
    const start = Math.max(0, matchIndex - 100);
    const end   = Math.min(text.length, matchIndex + 100);
    const win   = text.slice(start, end);
    if (PRICE_SUPPRESSORS.test(win)) return false;
    return SENSITIVE_LABELS.test(win);
  }

  let _observer = null;
  let _matchCount = 0;
  let _activeTypes = null;

  // ── Extension UI guard ──────────────────────────────────────────────────────

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

  // ── Core scan helpers ───────────────────────────────────────────────────────

  /**
   * Find all PII matches in a text string for enabled types.
   * Returns [{start, end, type}] sorted by start, overlaps removed (keep first/longest).
   */
  function _findMatches(text, types) {
    const matches = [];

    if (types.EMAIL && text.includes('@')) {
      const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: 'email' });
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    if (types.NUMERIC && types.NUMERIC !== 'off') {
      const re = new RegExp(NUMERIC_RE.source, NUMERIC_RE.flags);
      const conservative = (types.NUMERIC === 'conservative');
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!conservative || _hasContextLabel(text, m.index)) {
          matches.push({ start: m.index, end: m.index + m[0].length, type: 'numeric' });
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
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
   * Wrap matched portions of a text node in PII spans.
   * Processes right-to-left so earlier offsets stay valid after each split.
   */
  function _wrapTextNode(textNode, matches) {
    if (matches.length === 0) return 0;
    const parent = textNode.parentNode;
    if (!parent) return 0;

    let count = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end, type } = matches[i];
      const text = textNode.textContent;
      if (start >= text.length) continue;

      // textNode → [before][match][after]
      const afterNode = textNode.splitText(end);   // eslint-disable-line no-unused-vars
      const matchNode = textNode.splitText(start);

      const span = document.createElement('span');
      span.setAttribute(PII_ATTR, type);
      // NO data-bl-si-blur — PII blur is driven solely by the [data-bl-si-pii]
      // CSS rule, independent of blur-all. blur_engine sweeps never touch these spans.
      span.textContent = matchNode.textContent;
      parent.replaceChild(span, matchNode);

      count++;
      _matchCount++;
    }
    return count;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Scan rootEl for PII text and wrap matches in blur spans.
   * @param {Element} rootEl
   * @param {Object}  types  — { EMAIL: bool, NUMERIC: 'off'|'standard'|'conservative' }
   * @returns {number} match count
   */
  function scan(rootEl, types) {
    if (!rootEl || !types) return 0;
    const enabledTypes = {};
    let anyEnabled = false;
    for (const key of Object.keys(PATTERNS)) {
      const val = types[key];
      if (key === 'NUMERIC') {
        // String enum — 'off' is explicitly disabled despite being truthy.
        if (val && val !== 'off') { enabledTypes[key] = val; anyEnabled = true; }
      } else {
        if (val) { enabledTypes[key] = true; anyEnabled = true; }
      }
    }
    if (!anyEnabled) return 0;

    _activeTypes = enabledTypes;
    let total = 0;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const tn of nodes) {
      if (_isExtensionUI(tn)) continue;
      if (_isInsidePiiSpan(tn)) continue;
      const text = tn.textContent;
      if (!text || text.trim().length === 0) continue;
      const matches = _findMatches(text, enabledTypes);
      if (matches.length > 0) total += _wrapTextNode(tn, matches);
    }

    return total;
  }

  /**
   * Remove all PII spans and restore original text nodes.
   * @param {Element} rootEl
   */
  function clear(rootEl) {
    if (!rootEl) return;
    const spans = rootEl.querySelectorAll('[' + PII_ATTR + ']');
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    }
    _matchCount = 0;
  }

  /**
   * Watch for DOM mutations and scan new content.
   * Call scan() first so _activeTypes is populated.
   * @param {Element} rootEl
   */
  function observeMutations(rootEl) {
    if (_observer) _observer.disconnect();
    if (!rootEl || !_activeTypes) return;

    _observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (_isExtensionUI(node) || _isInsidePiiSpan(node)) continue;
            const text = node.textContent;
            if (text && text.trim().length > 0) {
              const matches = _findMatches(text, _activeTypes);
              if (matches.length > 0) _wrapTextNode(node, matches);
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (!_isExtensionUI(node) && !_isInsidePiiSpan(node)) {
              scan(node, _activeTypes);
            }
          }
        }
      }
    });

    _observer.observe(rootEl, { childList: true, subtree: true });
  }

  function stopObserving() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
  }

  function getMatchCount() { return _matchCount; }

  function getPatterns() { return PATTERNS; }

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
