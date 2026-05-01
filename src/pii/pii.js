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

  /**
   * Scan rootEl for PII text and wrap matches in blur spans.
   * @param {Element} rootEl
   * @param {Object}  types  — { email: bool, numeric: bool }
   * @returns {number} match count
   */
  function scan(rootEl, types) {
    if (!rootEl || !types) return 0;
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
    if (!anyEnabled) return 0;

    blsi.PiiState.setActiveTypes(enabledTypes);
    // Top-level scan defines the per-scan stats window. Recursive subtree
    // walks via _scanSubtree (called from handleMutations ELEMENT_NODE)
    // intentionally skip the reset so counters accumulate across the drain.
    blsi.PiiState.resetStats();
    return _scanSubtree(rootEl, enabledTypes);
  }

  /**
   * Walk a subtree without touching active-types or stats. Internal helper
   * shared by `scan()` (after it resets) and `handleMutations` (which adds
   * to existing per-drain counters).
   */
  function _scanSubtree(rootEl, enabledTypes) {
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
      if (blsi.PiiPreFilter.isExtensionUI(tn)) continue;
      if (blsi.PiiPreFilter.isInsidePiiSpan(tn)) continue;
      if (blsi.PiiPreFilter.isInsideCodeBlock(tn)) continue;
      const text = tn.textContent;
      if (!text || text.trim().length === 0) continue;
      // M1 digit pre-screen: skip detector regex when no digit is present,
      // unless EMAIL is enabled (email needs no digit).
      const digit = blsi.PiiPreFilter.hasDigit(text);
      if (!digit && !enabledTypes.email) continue;
      blsi.PiiState.recordNode(digit);
      const matches = blsi.PiiDetectors.findMatches(text, enabledTypes);
      if (matches.length > 0) total += _wrapTextNode(tn, matches);
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
    const activeTypes = blsi.PiiState.getActiveTypes();
    if (!activeTypes || !mutations || mutations.length === 0) return;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (blsi.PiiPreFilter.isExtensionUI(node)) continue;
            if (blsi.PiiPreFilter.isInsidePiiSpan(node)) continue;
            if (blsi.PiiPreFilter.isInsideCodeBlock(node)) continue;
            const text = node.textContent;
            if (text && text.trim().length > 0) {
              if (
                !blsi.PiiPreFilter.hasDigit(text) &&
                !activeTypes.email
              )
                continue;
              const matches = blsi.PiiDetectors.findMatches(text, activeTypes);
              if (matches.length > 0) _wrapTextNode(node, matches);
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              !blsi.PiiPreFilter.isExtensionUI(node) &&
              !blsi.PiiPreFilter.isInsidePiiSpan(node) &&
              !blsi.PiiPreFilter.isInsideCodeBlock(node)
            ) {
              // Recursive subtree walk — does NOT reset stats so counters
              // accumulate correctly across multi-subtree mutation drains.
              _scanSubtree(node, activeTypes);
            }
          }
        }
      } else if (mutation.type === "characterData") {
        const node = mutation.target;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        if (blsi.PiiPreFilter.isExtensionUI(node)) continue;
        if (blsi.PiiPreFilter.isInsidePiiSpan(node)) continue;
        if (blsi.PiiPreFilter.isInsideCodeBlock(node)) continue;
        const text = node.textContent;
        if (!text || text.trim().length === 0) continue;
        if (!blsi.PiiPreFilter.hasDigit(text) && !activeTypes.email) continue;
        const matches = blsi.PiiDetectors.findMatches(text, activeTypes);
        if (matches.length > 0) _wrapTextNode(node, matches);
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
    clear,
    handleMutations,
    getMatchCount,
    getPatterns,
    getStats,
  });
})();

blsi.PiiDetector = BlurrySitePiiDetector;
