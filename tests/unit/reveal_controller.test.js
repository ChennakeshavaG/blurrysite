/**
 * tests/unit/reveal_controller.test.js
 *
 * Unit tests for src/reveal_controller.js
 * Module exposes blsi.Reveal with: init, destroy, clearAll.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH   = path.resolve(__dirname, '../../src/reveal_controller.js');
const ENGINE_PATH   = path.resolve(__dirname, '../../src/blur_engine.js');
const SELECTOR_PATH = path.resolve(__dirname, '../../src/selector_utils.js');

function loadDeps() {
  if (!blsi.SelectorUtils && fs.existsSync(SELECTOR_PATH)) require(SELECTOR_PATH);
  if (!blsi.BlurEngine   && fs.existsSync(ENGINE_PATH))   require(ENGINE_PATH);
  if (!blsi.Reveal) {
    if (fs.existsSync(MODULE_PATH)) {
      require(MODULE_PATH);
    } else {
      (0, eval)(buildStubSource());
    }
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';
    blsi.Reveal = {
      init: function() {},
      destroy: function() {},
      clearAll: function() {},
    };
  })();
  `;
}

beforeAll(() => { loadDeps(); });

let mode = 'click';
let pickerActive = false;

function resetState() {
  mode = 'click';
  pickerActive = false;
  document.body.innerHTML = '';
  document.head.querySelectorAll('#bl-si-blur-styles').forEach(e => e.remove());
  document.querySelectorAll('[data-bl-si-blur]').forEach(el => delete el.dataset.blSiBlur);
  blsi.BlurEngine.unblurAll();
  try { blsi.Reveal.destroy(); } catch (_) {}
  blsi.Reveal.init({
    getMode: () => mode,
    isPickerActive: () => pickerActive,
  });
}

beforeEach(resetState);
afterEach(() => { try { blsi.Reveal.destroy(); } catch (_) {} });

function fireClick(target) {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ev, 'target', { value: target, writable: false });
  document.dispatchEvent(ev);
  return ev;
}

function fireMouseOver(target) {
  const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ev, 'target', { value: target, writable: false });
  document.dispatchEvent(ev);
}

describe('blsi.Reveal — click mode', () => {
  test('click on blurred element reveals it', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('second click on same element keeps reveal (link pass-through)', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('first click on blurred element calls preventDefault', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    const ev = fireClick(el);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('second click on revealed element does not preventDefault (link works)', () => {
    mode = 'click';
    const link = document.createElement('a');
    link.href = 'https://example.com';
    document.body.appendChild(link);
    blsi.BlurEngine.applyBlur(link);
    fireClick(link);
    const ev = fireClick(link);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('Escape dismisses click reveal', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(ev);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });

  test('input elements are skipped (reveal does not fire)', () => {
    mode = 'click';
    const input = document.createElement('input');
    document.body.appendChild(input);
    blsi.BlurEngine.applyBlur(input);
    fireClick(input);
    expect(input.dataset.blSiReveal).toBeUndefined();
  });

  test('picker active blocks click reveal', () => {
    mode = 'click';
    pickerActive = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });

  test('mode=none disables click reveal', () => {
    mode = 'none';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
});

describe('blsi.Reveal — hover mode', () => {
  test('mouseover on blurred element reveals it', () => {
    mode = 'hover';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireMouseOver(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('mouseout debounces dismiss by 50ms', () => {
    jest.useFakeTimers();
    mode = 'hover';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireMouseOver(el);
    const out = new MouseEvent('mouseout', { bubbles: true });
    Object.defineProperty(out, 'target', { value: el });
    document.dispatchEvent(out);
    // Still revealed right after mouseout
    expect(el.dataset.blSiReveal).toBe('1');
    jest.advanceTimersByTime(60);
    expect(el.dataset.blSiReveal).toBeUndefined();
    jest.useRealTimers();
  });
});

describe('blsi.Reveal.clearAll', () => {
  test('clears any active reveal', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
    blsi.Reveal.clearAll();
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
});

describe('blsi.Reveal — composedPath (shadow DOM pierce)', () => {
  test('onRevealMouseOver reveals composedPath target, not retargeted e.target', () => {
    // Simulates shadow DOM event retargeting: e.target = shadow host, but
    // composedPath()[0] = the actual blurred element inside the shadow root.
    mode = 'hover';
    const innerEl = document.createElement('span');
    innerEl.textContent = 'shadow content';
    document.body.appendChild(innerEl);
    blsi.BlurEngine.applyBlur(innerEl);

    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    // hostEl is NOT blurred — simulates unblurred shadow host

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: hostEl, writable: false });
    // Override composedPath to return the actual inner element first
    ev.composedPath = () => [innerEl, hostEl, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(innerEl.dataset.blSiReveal).toBe('1');
    expect(hostEl.dataset.blSiReveal).toBeUndefined();
  });

  test('onRevealClick reveals composedPath target, not retargeted e.target', () => {
    mode = 'click';
    const innerEl = document.createElement('span');
    innerEl.textContent = 'shadow content';
    document.body.appendChild(innerEl);
    blsi.BlurEngine.applyBlur(innerEl);

    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: hostEl, writable: false });
    ev.composedPath = () => [innerEl, hostEl, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(innerEl.dataset.blSiReveal).toBe('1');
    expect(hostEl.dataset.blSiReveal).toBeUndefined();
  });
});

describe('blsi.Reveal — shadow host reveal (parentElement boundary)', () => {
  test('hover over element inside shadow root reveals blurred shadow host', () => {
    // <rpl-badge data-bl-si-blur="1"> → #shadow-root → <span>NEW</span>
    // parentElement of <span> is null (ShadowRoot is not an Element).
    // findBlurredTarget must walk the host chain via getRootNode().host.
    mode = 'hover';
    const host = document.createElement('rpl-badge');
    document.body.appendChild(host);
    blsi.BlurEngine.applyBlur(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'NEW';
    shadow.appendChild(inner);

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: host, writable: false });
    ev.composedPath = () => [inner, shadow, host, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(host.dataset.blSiReveal).toBe('1');
  });

  test('hover over shadow DOM child finds blurred light DOM ancestor of host', () => {
    // <div data-bl-si-blur="1"> → <custom-el> → #shadow-root → <span>
    // parentElement chain: span→null; then host chain: host not blurred;
    // light DOM walk from host's parentElement: finds the blurred <div>.
    mode = 'hover';
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    blsi.BlurEngine.applyBlur(wrapper);

    const host = document.createElement('custom-el');
    wrapper.appendChild(host);
    // host is NOT blurred — blur is on the outer wrapper

    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'content';
    shadow.appendChild(inner);

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: host, writable: false });
    ev.composedPath = () => [inner, shadow, host, wrapper, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(wrapper.dataset.blSiReveal).toBe('1');
    expect(host.dataset.blSiReveal).toBeUndefined();
  });
});

describe('blsi.Reveal.destroy', () => {
  test('after destroy, clicks no longer reveal', () => {
    mode = 'click';
    blsi.Reveal.destroy();
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
});
