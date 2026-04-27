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
  "use strict";

  // Developer-facing profile switch. 'precise' runs all false-positive checks.
  // 'aggressive' runs only high-confidence checks (isVersion).
  // Flip this constant to change strictness — not exposed to users.
  const NUMERIC_PROFILE = 'precise'; // 'aggressive' | 'precise'

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
  //   4. Space/hyphen digit groups (phone-like) — 111-222-333  792 792  792-792
  //      MUST come before sub-5 so "4111 1111 1111 1111" wraps as ONE span.
  //      Requires ≥2 groups of ≥3 digits each, separated by [ \-\u00A0] only
  //      (no newline/tab — phone numbers don't span lines). Min-3-per-group
  //      lets short pairs like "792 792" match while still rejecting "12 2024".
  //   5. 4+ bare digit sequence  — 17150  account numbers  (catch-all)
  //
  // Intentionally broad: years 1000–2099 and versions are suppressed by isYear/isVersion in precise mode.
  const NUMERIC_RE =
    /[$\u20AC\u00A3\u00A5\u20B9\u20A9\u20BF\u20BA\u20A8\u20B1\u0E3F]\s*\d[\d,.'\u00A0]*|\b\d[\d,.'\u00A0]*\s*(?:USD|EUR|GBP|JPY|INR|BTC|ETH)\b|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d{3,}(?:[ \-\u00A0]\d{3,})+\b|\b\d{4,}\b/g;

  const PATTERNS = Object.freeze({
    EMAIL: { regex: EMAIL_RE, label: "email" },
    NUMERIC: { regex: NUMERIC_RE, label: "numeric" },
  });

  // ── False-positive checks ──────────────────────────────────────────────────
  // Each check: (matchText, text, matchIndex) => boolean
  //   return true  → suppress this match (it is a false positive)
  //   return false → keep this match
  //
  // To add a new check:
  //   1. Write a function following the signature above.
  //   2. Add it to FALSE_POSITIVE_CHECKS.precise (and optionally .aggressive).
  //   3. Add unit tests: one true-positive case + one false-positive case.
  //   4. Update docs/TEST_VALIDATION.md and docs/superpowers/specs/2026-04-18-pii-numeric-false-positives-design.md.

  function isYear(matchText /*, _text, _index */) {
    if (!/^\d{4}$/.test(matchText)) return false;
    const n = Number(matchText);
    return n >= 1000 && n <= 2099;
  }

  function isVersion(matchText, text, matchIndex) {
    const before = matchIndex > 0 ? text[matchIndex - 1] : '';
    if (before === 'v' || before === 'V') return true;
    const afterIdx = matchIndex + matchText.length;
    return text[afterIdx] === '.' && /\d/.test(text[afterIdx + 1] || '');
  }

  const _PUBLIC_PRICE_RE =
    /\/mo(?:nth)?|\/y(?:r|ear)|per month|per year|\bcart\b|\bqty\b|\bquantity\b|\bunits\b|\brating\b|\breviews?\b|\bstars?\b/i;

  function isPublicPrice(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 100);
    const end   = Math.min(text.length, matchIndex + 100);
    return _PUBLIC_PRICE_RE.test(text.slice(start, end));
  }

  const _COUNT_NOISE_RE =
    /unread|notifications?|messages?|followers?|following|likes?|views?|comments?|results?|items?|members?|subscribers?|posts?|connections?/i;

  function isCountNoise(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 150);
    const end   = Math.min(text.length, matchIndex + 150);
    return _COUNT_NOISE_RE.test(text.slice(start, end));
  }

  const FALSE_POSITIVE_CHECKS = Object.freeze({
    aggressive: [isVersion],
    precise:    [isYear, isVersion, isPublicPrice, isCountNoise],
  });

  function _falsePositivesCheck(matchText, text, matchIndex) {
    const checks = FALSE_POSITIVE_CHECKS[NUMERIC_PROFILE] || [];
    return checks.some(fn => fn(matchText, text, matchIndex));
  }

  const PII_ATTR = "data-bl-si-pii";

  let _matchCount = 0;
  let _activeTypes = null;

  // ── Extension UI guard ──────────────────────────────────────────────────────

  function _isExtensionUI(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    const toolbarId = blsi.ids
      ? blsi.ids.picker_toolbar
      : "bl-si-picker-toolbar";
    return (
      el.id === toolbarId ||
      el.closest("#" + toolbarId) !== null ||
      el.closest(".bl-si-toast") !== null ||
      el.closest(".bl-si-toolbar") !== null ||
      el.closest("[data-bl-si-zone]") !== null ||
      el.closest("#bl-si-svg-filters") !== null
    );
  }

  function _isInsidePiiSpan(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    return el.closest("[" + PII_ATTR + "]") !== null;
  }

  // ── Core scan helpers ───────────────────────────────────────────────────────

  /**
   * Find all PII matches in a text string for enabled types.
   * Returns [{start, end, type}] sorted by start, overlaps removed (keep first/longest).
   */
  function _findMatches(text, types) {
    const matches = [];

    if (types.email && text.includes("@")) {
      const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          type: "email",
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    if (types.numeric) {
      const re = new RegExp(NUMERIC_RE.source, NUMERIC_RE.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!_falsePositivesCheck(m[0], text, m.index)) {
          matches.push({ start: m.index, end: m.index + m[0].length, type: "numeric" });
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
      const afterNode = textNode.splitText(end); // eslint-disable-line no-unused-vars
      const matchNode = textNode.splitText(start);

      const span = document.createElement("span");
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
   * @param {Object}  types  — { EMAIL: bool, NUMERIC: bool }
   * @returns {number} match count
   */
  function scan(rootEl, types) {
    if (!rootEl || !types) return 0;
    const enabledTypes = {};
    let anyEnabled = false;
    // types uses lowercase keys: { email: bool, numeric: bool }
    if (types.email) { enabledTypes.email = true; anyEnabled = true; }
    if (types.numeric) { enabledTypes.numeric = true; anyEnabled = true; }
    if (!anyEnabled) return 0;

    _activeTypes = enabledTypes;
    let total = 0;

    const walker = document.createTreeWalker(
      rootEl,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );
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
    const spans = rootEl.querySelectorAll("[" + PII_ATTR + "]");
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    }
    _matchCount = 0;
  }

  /**
   * Handle a batch of MutationRecord[] dispatched by blur_engine.
   * Subscriber-style: PII detector owns no observer — blur_engine runs the
   * single MO per root and fans records out via subscribeMutations.
   *
   * Covers:
   *   - childList: new TEXT_NODE → wrap matches; new ELEMENT_NODE → scan subtree
   *   - characterData: text node whose textContent changed (typed input in
   *     contenteditable, dynamic .textContent assignment) → wrap matches.
   *     Skipped if the text node already lives inside a [data-bl-si-pii] wrapper
   *     (existing wrapper covers the updated content).
   *   - attributes / other types: ignored.
   *
   * Precondition: scan() must have run first to seed _activeTypes; else no-op.
   *
   * @param {MutationRecord[]} mutations
   * @param {Document|ShadowRoot} _root  — unused; kept for subscriber signature
   */
  function handleMutations(mutations, _root) {
    if (!_activeTypes || !mutations || mutations.length === 0) return;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
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
      } else if (mutation.type === "characterData") {
        const node = mutation.target;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        if (_isExtensionUI(node) || _isInsidePiiSpan(node)) continue;
        const text = node.textContent;
        if (!text || text.trim().length === 0) continue;
        const matches = _findMatches(text, _activeTypes);
        if (matches.length > 0) _wrapTextNode(node, matches);
      }
    }
  }

  function getMatchCount() {
    return _matchCount;
  }

  function getPatterns() {
    return PATTERNS;
  }

  return Object.freeze({
    scan,
    clear,
    handleMutations,
    getMatchCount,
    getPatterns,
  });
})();

blsi.PiiDetector = BlurrySitePiiDetector;
