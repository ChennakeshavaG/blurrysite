/**
 * pii/pii_pre_filter.js — Stage 0 whole-node drops.
 *
 * Cheap DOM + text checks that decide whether a text node should bypass
 * the PII pipeline entirely:
 *   - isExtensionUI(node)            — extension-owned UI tree
 *   - isInsidePiiSpan(node)          — already-wrapped node
 *   - isInsideCodeBlock(node)        — <code>/<pre>/<kbd>/<samp> ancestor
 *   - hasDigit(text)                 — M1 whole-node digit pre-screen
 *   - hasDigitOrLongAlnum(text)      — extended pre-screen for the numeric
 *                                       branch when the identifier sub-pass
 *                                       is in play; lets through long alpha
 *                                       tokens (Bearer, base64) that have
 *                                       no digit but still contain a 8+
 *                                       alnum run worth scanning.
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

  // Extended pre-screen for the numeric branch — passes nodes that contain
  // at least one digit OR an 8+ char alnum run. The identifier sub-pass
  // dispositive detectors (Bearer / base64 refresh tokens / etc.) emit on
  // long alpha-only values that the bare-`/\d/` filter would drop, so the
  // numeric path uses this helper instead of `hasDigit`.
  const _HAS_DIGIT_OR_LONG_ALNUM_RE = /\d|[A-Za-z0-9]{8,}/;

  var _EXT_UI_SELECTOR =
    "#bl-si-picker-toolbar, .bl-si-toast, .bl-si-toolbar, [data-bl-si-zone], #bl-si-svg-filters";

  var _CODE_EDITOR_SELECTOR =
    "[data-code], .codehilite, .cm-editor, .CodeMirror, .monaco-editor, .ace_editor";

  function isExtensionUIElement(el) {
    return el.matches !== undefined && el.matches(_EXT_UI_SELECTOR);
  }

  function isCodePre(el) {
    if (el.tagName !== "PRE") return false;
    if (el.querySelector("code")) return true;
    var cls = el.className;
    if (typeof cls === "string" && (cls.indexOf("highlight") !== -1 || cls.indexOf("lang") !== -1 || cls.indexOf("language") !== -1)) return true;
    if (el.hasAttribute("data-code")) return true;
    var parent = el.parentElement;
    if (parent && parent.tagName === "DIV" && typeof parent.className === "string" && parent.className.indexOf("highlight") !== -1) return true;
    return false;
  }

  function isCodeEditorWidget(el) {
    return el.matches !== undefined && el.matches(_CODE_EDITOR_SELECTOR);
  }

  function isExtensionUI(node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return true;
    return el.closest(_EXT_UI_SELECTOR) !== null;
  }

  function isInsidePiiSpan(node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return false;
    return el.closest("[" + blsi.PiiState.PII_ATTR + "]") !== null;
  }

  function hasDigit(text) {
    return _HAS_DIGIT_RE.test(text);
  }

  function hasDigitOrLongAlnum(text) {
    return _HAS_DIGIT_OR_LONG_ALNUM_RE.test(text);
  }

  return Object.freeze({
    isExtensionUI,
    isExtensionUIElement,
    isCodePre,
    isCodeEditorWidget,
    isInsidePiiSpan,
    hasDigit,
    hasDigitOrLongAlnum,
  });
})();

blsi.PiiPreFilter = BlurrySitePiiPreFilter;
