/**
 * selection_blur.js — Blur user-selected text without blurring the entire element.
 *
 * Uses the Selection API to wrap selected text ranges in blur spans.
 * Integrates with the blur engine CSS rules via data-bl-si-blur attribute.
 *
 * Exposed as blsi.SelectionBlur (IIFE — no ES module syntax).
 */

const BlurrySiteSelectionBlur = (() => {
  'use strict';

  const SEL_ATTR = 'data-bl-si-selection';
  const BLUR_ATTR = 'data-bl-si-blur';

  let _selections = []; // { id, text, spans: Element[] }
  let _idCounter = 0;

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
      el.closest('[data-bl-si-zone]') !== null
    );
  }

  function _generateId() {
    _idCounter++;
    return 'sel_' + _idCounter + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ── Core blur selection logic ──────────────────────────────────────────────

  /**
   * Blur the current text selection.
   * @returns {{ id: string, text: string } | null} The selection blur record, or null if nothing to blur.
   */
  function blurSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    if (_isExtensionUI(container)) return null;

    const text = selection.toString();
    if (!text || text.trim().length === 0) return null;

    const id = _generateId();
    const spans = _wrapRange(range, id);

    if (spans.length === 0) return null;

    const record = { id, text, spans };
    _selections.push(record);
    selection.removeAllRanges();

    return { id, text };
  }

  /**
   * Wrap all text nodes within a range in blur spans.
   * Processes from last to first to preserve offsets.
   */
  function _wrapRange(range, id) {
    // Collect all text nodes within the range
    const textNodes = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      if (range.intersectsNode(node)) {
        textNodes.push(node);
      }
    }

    const spans = [];

    // Process from last to first to preserve offsets
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const tn = textNodes[i];
      if (_isExtensionUI(tn)) continue;

      const parent = tn.parentNode;
      if (!parent) continue;

      // Determine the in-range portion of this text node
      let startOffset = 0;
      let endOffset = tn.textContent.length;

      if (tn === range.startContainer) startOffset = range.startOffset;
      if (tn === range.endContainer) endOffset = range.endOffset;

      if (startOffset >= endOffset) continue;
      const selectedText = tn.textContent.slice(startOffset, endOffset);
      if (!selectedText || selectedText.length === 0) continue;

      // Split and wrap
      let targetNode = tn;
      if (endOffset < tn.textContent.length) {
        targetNode.splitText(endOffset);
      }
      if (startOffset > 0) {
        targetNode = targetNode.splitText(startOffset);
      }

      const span = document.createElement('span');
      span.setAttribute(SEL_ATTR, id);
      span.setAttribute(BLUR_ATTR, '1');
      span.textContent = targetNode.textContent;
      parent.replaceChild(span, targetNode);
      spans.unshift(span); // maintain document order
    }

    return spans;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    // No-op for now — context menu integration is handled by content_script
  }

  function destroy() {
    clearAll();
  }

  /**
   * Remove all selection blurs, restoring original text nodes.
   */
  function clearAll() {
    const allSpans = document.querySelectorAll('[' + SEL_ATTR + ']');
    for (const span of allSpans) {
      const parent = span.parentNode;
      if (!parent) continue;
      const textNode = document.createTextNode(span.textContent);
      parent.replaceChild(textNode, span);
      parent.normalize();
    }
    _selections = [];
  }

  /**
   * Get all active selection blurs.
   * @returns {Array<{ id: string, text: string }>}
   */
  function getSelectionBlurs() {
    return _selections.map(s => ({ id: s.id, text: s.text }));
  }

  /**
   * Remove a specific selection blur by ID.
   * @param {string} id
   */
  function removeSelectionBlur(id) {
    const spans = document.querySelectorAll('[' + SEL_ATTR + '="' + id + '"]');
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      const textNode = document.createTextNode(span.textContent);
      parent.replaceChild(textNode, span);
      parent.normalize();
    }
    _selections = _selections.filter(s => s.id !== id);
  }

  return Object.freeze({
    blurSelection,
    init,
    destroy,
    clearAll,
    getSelectionBlurs,
    removeSelectionBlur,
  });
})();

blsi.SelectionBlur = BlurrySiteSelectionBlur;
