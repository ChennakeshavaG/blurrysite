/**
 * pii/pii.js — Facade for the PII detector pipeline.
 *
 * Public surface (preserved from the original src/pii_detector.js global):
 *   blsi.PiiDetector = { scan, clear, handleMutations, getMatchCount, getPatterns }
 *
 * Internally delegates to blsi.PiiState / PiiPreFilter / PiiSuppressors /
 * PiiDetectors. Owns no observer — content_script.applyState subscribes
 * handleMutations to the engine's mutation dispatcher when PII is enabled.
 *
 * Exposed as blsi.PiiDetector (IIFE — no ES module syntax).
 */

const BlurrySitePiiDetector = (() => {
  "use strict";

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
      span.setAttribute(blsi.PiiState.PII_ATTR, type);
      // NO data-bl-si-blur — PII blur is driven solely by the [data-bl-si-pii]
      // CSS rule, independent of blur-all. blur_engine sweeps never touch these spans.
      span.textContent = matchNode.textContent;
      parent.replaceChild(span, matchNode);

      count++;
      blsi.PiiState.incrementMatchCount();
    }
    return count;
  }

  var CHUNK_SIZE = 500;

  var _chunkedIdleHandle = null;
  var _scanComplete = true;
  var _pendingMutations = null;

  function scan(rootEl, types, onDone) {
    cancelChunkedScan();
    if (!rootEl || !types) { if (onDone) onDone(0); return 0; }
    const enabledTypes = {};
    let anyEnabled = false;
    if (types.email) {
      enabledTypes.email = true;
      anyEnabled = true;
    }
    if (types.numeric) {
      enabledTypes.numeric = true;
      anyEnabled = true;
    }
    if (!anyEnabled) { if (onDone) onDone(0); return 0; }

    blsi.PiiState.setActiveTypes(enabledTypes);
    if (blsi.PiiCountry && typeof blsi.PiiCountry.detect === "function") {
      blsi.PiiState.setCountry(blsi.PiiCountry.detect());
    }
    blsi.PiiState.resetStats();

    if (!onDone) {
      _scanComplete = true;
      return _scanSubtree(rootEl, enabledTypes);
    }

    _scanComplete = false;
    _pendingMutations = [];
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ALL, _walkerFilter, false);
    var schedule = typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : setTimeout;
    _runChunked(walker, 0, enabledTypes, onDone, schedule);
    return 0;
  }

  function _runChunked(walker, total, enabledTypes, onDone, schedule) {
    var count = 0;
    var node;
    while (count < CHUNK_SIZE && (node = walker.nextNode())) {
      total += _processTextNode(node, enabledTypes);
      count++;
    }
    if (!node) {
      _chunkedIdleHandle = null;
      _scanComplete = true;
      var buffered = _pendingMutations;
      _pendingMutations = null;
      if (buffered && buffered.length > 0) {
        for (var i = 0; i < buffered.length; i++) {
          handleMutations(buffered[i].m, buffered[i].r);
        }
      }
      onDone(total);
      return;
    }
    _chunkedIdleHandle = schedule(function () {
      _runChunked(walker, total, enabledTypes, onDone, schedule);
    });
  }

  function cancelChunkedScan() {
    if (_chunkedIdleHandle != null) {
      if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(_chunkedIdleHandle);
      else clearTimeout(_chunkedIdleHandle);
      _chunkedIdleHandle = null;
    }
    _scanComplete = true;
    _pendingMutations = null;
  }

  var _BLOCK_RE = /^(?:P|DIV|LI|TD|TH|TR|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|MAIN|BLOCKQUOTE|DD|DT|FIGCAPTION|FIGURE|H[1-6]|HR|OL|UL|DL|PRE|TABLE|TBODY|THEAD|TFOOT|DETAILS|SUMMARY|FORM|FIELDSET)$/;

  function _precedingText(textNode, limit) {
    var parts = [];
    var len = 0;
    var node = textNode;
    while (len < limit) {
      var prev = node.previousSibling;
      if (prev) {
        if (prev.nodeType === Node.ELEMENT_NODE && _BLOCK_RE.test(prev.tagName)) break;
        var t = prev.textContent || "";
        if (t) { parts.push(t); len += t.length; }
        node = prev;
      } else {
        var parent = node.parentNode;
        if (!parent || parent.nodeType !== Node.ELEMENT_NODE || _BLOCK_RE.test(parent.tagName)) break;
        node = parent;
      }
    }
    parts.reverse();
    var result = parts.join("");
    return result.length > limit ? result.slice(result.length - limit) : result;
  }

  var _SHORT_DIGIT_RE = /^\s*\d[\d \-]{2,14}\d\s*$/;

  var _SKIP_RE = /^(?:CODE|KBD|SAMP)$/;

  var _walkerFilter = {
    acceptNode: function (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (blsi.PiiPreFilter.isExtensionUIElement(node)) return NodeFilter.FILTER_REJECT;
        if (_SKIP_RE.test(node.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.tagName === "PRE" && blsi.PiiPreFilter.isCodePre(node)) return NodeFilter.FILTER_REJECT;
        if (blsi.PiiPreFilter.isCodeEditorWidget(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  };

  var _CODE_ANCESTOR_SELECTOR =
    "code, kbd, samp, [data-code], .codehilite, .cm-editor, .CodeMirror, .monaco-editor, .ace_editor";

  function _isInsideExtensionUI(node) {
    return blsi.PiiPreFilter.isExtensionUI(node);
  }

  function _shouldSkipMutation(node) {
    if (_isInsideExtensionUI(node)) return true;
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return true;
    if (el.closest(_CODE_ANCESTOR_SELECTOR)) return true;
    var pre = el.closest("pre");
    if (pre && blsi.PiiPreFilter.isCodePre(pre)) return true;
    return false;
  }

  function _processTextNode(tn, enabledTypes) {
    if (blsi.PiiPreFilter.isInsidePiiSpan(tn)) return 0;
    const text = tn.textContent;
    if (!text || text.length < 4) return 0;
    const numericPath = enabledTypes.numeric
      ? blsi.PiiPreFilter.hasDigitOrLongAlnum(text)
      : false;
    const digit = blsi.PiiPreFilter.hasDigit(text);
    if (!digit && !numericPath && !enabledTypes.email) return 0;
    blsi.PiiState.recordNode(digit);
    const matches = blsi.PiiDetectors.findMatches(text, enabledTypes);
    if (matches.length > 0) return _wrapTextNode(tn, matches);

    // Cross-node keyword lookaround: short digit-only text in its own element
    // (e.g. <span>90002883607</span>) preceded by a keyword in a sibling/parent.
    if (enabledTypes.numeric && digit && _SHORT_DIGIT_RE.test(text)) {
      var preceding = _precedingText(tn, 120);
      if (preceding && blsi.PiiDetectors.hasKeywordTrail(preceding)) {
        var trimmed = text.trim();
        var start = text.indexOf(trimmed);
        return _wrapTextNode(tn, [
          { start: start, end: start + trimmed.length, type: "numeric" },
        ]);
      }
    }
    return 0;
  }

  /**
   * Walk a subtree without touching active-types or stats. Internal helper
   * shared by `scan()` (synchronous fallback) and `handleMutations` (which
   * adds to existing per-drain counters).
   */
  function _scanSubtree(rootEl, enabledTypes) {
    var total = 0;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ALL, _walkerFilter, false);
    var node;
    while ((node = walker.nextNode())) {
      total += _processTextNode(node, enabledTypes);
    }
    return total;
  }

  /**
   * Remove all PII spans and restore original text nodes.
   */
  function clear(rootEl) {
    if (!rootEl) return;
    const spans = rootEl.querySelectorAll("[" + blsi.PiiState.PII_ATTR + "]");
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    }
    blsi.PiiState.resetMatchCount();
    blsi.PiiState.resetStats();
  }

  /**
   * Handle a batch of MutationRecord[] dispatched by blur_engine.
   * Subscriber-style: PII detector owns no observer — blur_engine runs the
   * single MO per root and fans records out via subscribeMutations.
   *
   * Covers:
   *   - childList: new TEXT_NODE → wrap matches; new ELEMENT_NODE → scan subtree
   *   - characterData: text node whose textContent changed → wrap matches.
   *     Skipped if the text node already lives inside a [data-bl-si-pii] wrapper.
   *   - attributes / other types: ignored.
   *
   * Precondition: scan() must have run first to seed activeTypes; else no-op.
   */
  function handleMutations(mutations, _root) {
    if (!_scanComplete) {
      if (_pendingMutations) _pendingMutations.push({ m: mutations, r: _root });
      return;
    }
    var activeTypes = blsi.PiiState.getActiveTypes();
    if (!activeTypes || !mutations || mutations.length === 0) return;

    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === "childList") {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType === Node.TEXT_NODE) {
            if (_shouldSkipMutation(node)) continue;
            _processTextNode(node, activeTypes);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute && node.hasAttribute(blsi.PiiState.PII_ATTR)) continue;
            if (_shouldSkipMutation(node)) continue;
            _scanSubtree(node, activeTypes);
          }
        }
      } else if (mutation.type === "characterData") {
        if (mutation.target && !_shouldSkipMutation(mutation.target)) _processTextNode(mutation.target, activeTypes);
      }
    }
  }

  function getMatchCount() {
    return blsi.PiiState.getMatchCount();
  }

  function getPatterns() {
    return blsi.PiiDetectors.getPatterns();
  }

  function getStats() {
    return blsi.PiiState.getStats();
  }

  return Object.freeze({
    scan,
    cancelChunkedScan,
    clear,
    handleMutations,
    getMatchCount,
    getPatterns,
    getStats,
  });
})();

blsi.PiiDetector = BlurrySitePiiDetector;
