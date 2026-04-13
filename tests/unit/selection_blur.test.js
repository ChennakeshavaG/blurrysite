/**
 * tests/unit/selection_blur.test.js
 *
 * Unit tests for src/selection_blur.js
 * Module exposes blsi.SelectionBlur with:
 *   blurSelection, init, destroy, clearAll, getSelectionBlurs, removeSelectionBlur
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/selection_blur.js');

function freshLoad() {
  delete blsi.SelectionBlur;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

/**
 * Helper: create a selection range over text content within an element.
 * jsdom supports the Selection API, so we can programmatically select text.
 */
function selectText(element, startOffset, endOffset) {
  const range = document.createRange();
  const textNode = element.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    throw new Error('Element must contain a text node');
  }
  range.setStart(textNode, startOffset || 0);
  range.setEnd(textNode, endOffset !== undefined ? endOffset : textNode.textContent.length);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe('selection_blur.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    freshLoad();
  });

  afterEach(() => {
    try { blsi.SelectionBlur.destroy(); } catch (_) {}
    document.body.innerHTML = '';
  });

  test('blurSelection wraps selected text in a blur span', () => {
    document.body.innerHTML = '<p>Hello World</p>';
    const p = document.querySelector('p');
    selectText(p, 0, 5); // "Hello"

    const result = blsi.SelectionBlur.blurSelection();
    expect(result).not.toBeNull();
    expect(result.text).toBe('Hello');

    const span = document.querySelector('[data-bl-si-selection]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('Hello');
    expect(span.getAttribute('data-bl-si-blur')).toBe('1');
  });

  test('blurSelection preserves surrounding text', () => {
    document.body.innerHTML = '<p>Hello World</p>';
    const p = document.querySelector('p');
    selectText(p, 6, 11); // "World"

    blsi.SelectionBlur.blurSelection();
    expect(p.textContent).toBe('Hello World');
  });

  test('blurSelection returns null for collapsed selection', () => {
    document.body.innerHTML = '<p>Hello</p>';
    const sel = document.getSelection();
    sel.removeAllRanges();
    // No selection
    const result = blsi.SelectionBlur.blurSelection();
    expect(result).toBeNull();
  });

  test('blurSelection returns null for whitespace-only selection', () => {
    document.body.innerHTML = '<p>   </p>';
    const p = document.querySelector('p');
    selectText(p, 0, 3);

    const result = blsi.SelectionBlur.blurSelection();
    expect(result).toBeNull();
  });

  test('blurSelection skips extension UI elements', () => {
    document.body.innerHTML = '<div id="bl-si-picker-toolbar"><p>Secret Text</p></div>';
    const p = document.querySelector('p');
    selectText(p, 0, 6);

    const result = blsi.SelectionBlur.blurSelection();
    expect(result).toBeNull();
  });

  test('clearAll removes all selection blur spans', () => {
    document.body.innerHTML = '<p>Hello World Foo</p>';
    const p = document.querySelector('p');

    // First selection
    selectText(p, 0, 5);
    blsi.SelectionBlur.blurSelection();

    expect(document.querySelectorAll('[data-bl-si-selection]').length).toBe(1);

    blsi.SelectionBlur.clearAll();
    expect(document.querySelectorAll('[data-bl-si-selection]').length).toBe(0);
    // Text should be restored
    expect(p.textContent).toContain('Hello');
  });

  test('getSelectionBlurs returns records for active blurs', () => {
    document.body.innerHTML = '<p>Hello World</p>';
    const p = document.querySelector('p');
    selectText(p, 0, 5);
    blsi.SelectionBlur.blurSelection();

    const blurs = blsi.SelectionBlur.getSelectionBlurs();
    expect(blurs.length).toBe(1);
    expect(blurs[0].text).toBe('Hello');
    expect(blurs[0].id).toBeTruthy();
  });

  test('removeSelectionBlur removes a specific blur by ID', () => {
    document.body.innerHTML = '<p>Hello World</p>';
    const p = document.querySelector('p');
    selectText(p, 0, 5);
    const result = blsi.SelectionBlur.blurSelection();

    expect(document.querySelectorAll('[data-bl-si-selection]').length).toBe(1);

    blsi.SelectionBlur.removeSelectionBlur(result.id);
    expect(document.querySelectorAll('[data-bl-si-selection]').length).toBe(0);
    expect(blsi.SelectionBlur.getSelectionBlurs().length).toBe(0);
  });

  test('each blurSelection generates unique IDs', () => {
    document.body.innerHTML = '<p>AAA</p><p>BBB</p>';
    const ps = document.querySelectorAll('p');

    selectText(ps[0], 0, 3);
    const r1 = blsi.SelectionBlur.blurSelection();

    selectText(ps[1], 0, 3);
    const r2 = blsi.SelectionBlur.blurSelection();

    expect(r1.id).not.toBe(r2.id);
  });

  test('destroy clears all blurs', () => {
    document.body.innerHTML = '<p>Hello World</p>';
    const p = document.querySelector('p');
    selectText(p, 0, 5);
    blsi.SelectionBlur.blurSelection();

    blsi.SelectionBlur.destroy();
    expect(document.querySelectorAll('[data-bl-si-selection]').length).toBe(0);
  });

  test('removeSelectionBlur with non-existent ID is a no-op', () => {
    document.body.innerHTML = '<p>Hello</p>';
    expect(() => blsi.SelectionBlur.removeSelectionBlur('fake_id')).not.toThrow();
  });
});
