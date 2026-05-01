/**
 * pii/pii_pre_filter.js — Stage 0 whole-node drops.
 *
 * Cheap DOM + text checks that decide whether a text node should bypass
 * the PII pipeline entirely:
 *   - isExtensionUI(node)      — extension-owned UI tree
 *   - isInsidePiiSpan(node)    — already-wrapped node
 *   - isInsideCodeBlock(node)  — <code>/<pre>/<kbd>/<samp> ancestor
 *   - hasDigit(text)           — M1 whole-node digit pre-screen
 *
 * Exposed as blsi.PiiPreFilter (IIFE — no ES module syntax).
 */

const BlurrySitePiiPreFilter = (() => {
  "use strict";

  // M1: cheapest possible pre-screen — most consumer text nodes (titles,
  // links, prose) carry no digits at all, so bypass detector regex on them.
  // Email is the only PII that doesn't need a digit; the facade still runs
  // EMAIL on no-digit text when types.email is on.
  const _HAS_DIGIT_RE = /\d/;

  // Code-block / technical-token containers — anything inside these is a
  // dev-doc artefact, never user-facing PII. Highest-impact early-exit on
  // technical sites (GitHub, Stack Overflow, MDN, JIRA).
  const _CODE_SELECTOR =
    "code, pre, kbd, samp, [data-code], .highlight, .codehilite";

  function isExtensionUI(node) {
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

  function isInsidePiiSpan(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    return el.closest("[" + blsi.PiiState.PII_ATTR + "]") !== null;
  }

  function isInsideCodeBlock(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el) return false;
    return el.closest(_CODE_SELECTOR) !== null;
  }

  function hasDigit(text) {
    return _HAS_DIGIT_RE.test(text);
  }

  return Object.freeze({
    isExtensionUI,
    isInsidePiiSpan,
    isInsideCodeBlock,
    hasDigit,
  });
})();

blsi.PiiPreFilter = BlurrySitePiiPreFilter;
